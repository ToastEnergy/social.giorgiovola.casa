import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { FFMPEG_PATH } from '$app/env/private';
import { limitConcurrency } from './concurrency.js';

/**
 * Voice notes: whatever a browser or app recorded (WebM/Opus, MP4/AAC, Ogg, WAV, MP3) is
 * transcoded with ffmpeg to mono AAC-LC, 48 kHz, 48 kbps in an M4A with its index at the front
 * (+faststart), which every browser and phone plays and can seek in over HTTP Range. The same
 * work strips the metadata, evens out the loudness, trims trailing silence, measures the real
 * duration and draws the waveform. ffmpeg runs on untrusted input, so it only gets the
 * demuxers and protocols a recording needs, a time limit and a concurrency cap.
 */

export const MAX_AUDIO_MS = 60 * 60 * 1000;
// recorders stop a little late: up to this much over the limit is cut, not refused
const GRACE_MS = 5000;
/** The most a recording (one upload, or the chunks of a session together) may weigh. */
export const MAX_AUDIO_INPUT_BYTES = 150 * 1024 * 1024;
export const WAVEFORM_BARS = 64;

// what browsers (MediaRecorder), expo-audio and common files give. Names of demuxers, not file
// extensions: "mov" covers mp4 and m4a, "matroska" webm
const DEMUXERS = 'matroska,webm,mov,mp4,m4a,ogg,wav,mp3';
const CODECS = new Set([
	'opus',
	'vorbis',
	'aac',
	'mp3',
	'flac',
	'alac',
	'pcm_s16le',
	'pcm_s24le',
	'pcm_s32le',
	'pcm_f32le',
	'pcm_u8',
	'pcm_alaw',
	'pcm_mulaw'
]);

const FFMPEG = FFMPEG_PATH;
// ffprobe ships next to ffmpeg; a bare `ffmpeg` means both are on PATH
const FFPROBE = FFMPEG.replace(/ffmpeg(\.exe)?$/i, (_, exe) => `ffprobe${exe ?? ''}`);

/** A recording that can't be used; the message is for the uploader. */
export class AudioError extends Error {}

let available: Promise<boolean> | null = null;

/** Whether ffmpeg and ffprobe can run here: without them there are no voice notes. Cached. */
export function audioAvailable(): Promise<boolean> {
	if (FFMPEG === 'off') return Promise.resolve(false);
	available ??= Promise.all([FFMPEG, FFPROBE].map(canRun)).then((ok) => {
		const all = ok.every(Boolean);
		if (!all) console.warn(`voice notes are off: ${FFMPEG} or ${FFPROBE} can't be run`);
		return all;
	});
	return available;
}

function canRun(cmd: string) {
	return new Promise<boolean>((resolve) => {
		const child = spawn(cmd, ['-hide_banner', '-version'], { stdio: 'ignore' });
		const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
		child.on('error', () => resolve(false));
		child.on('close', (code) => {
			clearTimeout(timer);
			resolve(code === 0);
		});
	});
}

type RunOptions = {
	timeoutMs: number;
	/** gets stdout as it comes; without it stdout is collected (up to 1MB) */
	onData?: (chunk: Buffer) => void;
};

/** Runs a command, never through a shell; rejects on a non-zero exit or the timeout. */
function run(cmd: string, args: string[], { timeoutMs, onData }: RunOptions) {
	return new Promise<string>((resolve, reject) => {
		const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
		const out: Buffer[] = [];
		let outBytes = 0;
		let stderr = '';
		let timedOut = false;
		const timer = setTimeout(() => {
			timedOut = true;
			child.kill('SIGKILL');
		}, timeoutMs);
		child.stdout.on('data', (chunk: Buffer) => {
			if (onData) return onData(chunk);
			outBytes += chunk.length;
			if (outBytes <= 1024 * 1024) out.push(chunk);
		});
		// only the end is kept: it holds the error
		child.stderr.on('data', (chunk: Buffer) => (stderr = (stderr + chunk).slice(-2000)));
		child.on('error', (e) => {
			clearTimeout(timer);
			reject(e);
		});
		child.on('close', (code) => {
			clearTimeout(timer);
			if (timedOut) reject(new AudioError('Processing the recording took too long'));
			else if (code !== 0)
				reject(new FfmpegError(`${path.basename(cmd)} exited ${code}: ${stderr}`));
			else resolve(Buffer.concat(out).toString('utf8'));
		});
	});
}

class FfmpegError extends Error {}

// inputs are always paths in the staging directory. `file:` keeps a name from being read as
// another protocol (and C: on Windows from being one)
const INPUT = ['-protocol_whitelist', 'file', '-format_whitelist', DEMUXERS];
const fileUrl = (file: string) => `file:${file}`;

type Probe = { durationMs: number | null };

/** Checks that the file is a recording we take: a known container with an audio stream. */
async function probe(file: string): Promise<Probe> {
	let json: string;
	try {
		json = await run(
			FFPROBE,
			[
				'-v',
				'error',
				'-hide_banner',
				...INPUT,
				'-print_format',
				'json',
				'-show_entries',
				'format=format_name,duration:stream=codec_type,codec_name',
				fileUrl(file)
			],
			{ timeoutMs: 15_000 }
		);
	} catch (e) {
		if (e instanceof FfmpegError) throw new AudioError('Unsupported or corrupted audio file');
		throw e;
	}
	const info = JSON.parse(json) as {
		format?: { duration?: string };
		streams?: { codec_type?: string; codec_name?: string }[];
	};
	const audio = info.streams?.find((s) => s.codec_type === 'audio');
	if (!audio) throw new AudioError('The file has no audio');
	if (!audio.codec_name || !CODECS.has(audio.codec_name))
		throw new AudioError('Unsupported audio format, record WebM/Opus, MP4/AAC, Ogg, WAV or MP3');
	// Chrome's MediaRecorder writes WebM without a duration: then it's measured while decoding
	const seconds = Number(info.format?.duration);
	const durationMs = Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : null;
	if (durationMs !== null && durationMs > MAX_AUDIO_MS + GRACE_MS) throw tooLong();
	return { durationMs };
}

const tooLong = () => new AudioError('Voice notes can be at most 1 hour long');

// ≈ 10 s + 0.1 × the length, the worst case when the length isn't known yet
const timeoutFor = (durationMs: number | null) =>
	10_000 + 0.1 * (durationMs ?? MAX_AUDIO_MS + GRACE_MS);

// the waveform and the silence are measured on 8 kHz mono, in blocks of 50 ms
const ANALYSIS_RATE = 8000;
const BLOCK = ANALYSIS_RATE / 20;
const BLOCK_MS = 50;

type Analysis = { durationMs: number; peaks: number[] };

/** Decodes to 16-bit PCM and keeps the peak of every block, streaming. */
async function analyse(file: string, durationMs: number | null): Promise<Analysis> {
	const peaks: number[] = [];
	let samples = 0;
	let blockPeak = 0;
	let inBlock = 0;
	let carry: Buffer | null = null;
	const onData = (chunk: Buffer) => {
		let data = carry ? Buffer.concat([carry, chunk]) : chunk;
		const usable = data.length - (data.length % 2);
		carry = usable < data.length ? data.subarray(usable) : null;
		data = data.subarray(0, usable);
		for (let i = 0; i < data.length; i += 2) {
			const v = Math.abs(data.readInt16LE(i));
			if (v > blockPeak) blockPeak = v;
			if (++inBlock === BLOCK) {
				peaks.push(blockPeak / 32768);
				blockPeak = 0;
				inBlock = 0;
			}
		}
		samples += data.length / 2;
	};
	try {
		await run(
			FFMPEG,
			[
				'-nostdin',
				'-v',
				'error',
				'-hide_banner',
				...INPUT,
				'-i',
				fileUrl(file),
				'-map',
				'0:a:0',
				'-vn',
				'-sn',
				'-dn',
				// a little over the limit is enough to tell it's too long
				'-t',
				String((MAX_AUDIO_MS + GRACE_MS + 1000) / 1000),
				'-ac',
				'1',
				'-ar',
				String(ANALYSIS_RATE),
				'-f',
				's16le',
				'pipe:1'
			],
			{ timeoutMs: timeoutFor(durationMs), onData }
		);
	} catch (e) {
		if (e instanceof FfmpegError) throw new AudioError('Unsupported or corrupted audio file');
		throw e;
	}
	if (inBlock > 0) peaks.push(blockPeak / 32768);
	return { durationMs: Math.round((samples / ANALYSIS_RATE) * 1000), peaks };
}

// trailing blocks quieter than this (relative to the loudest peak, with an absolute floor) are
// silence; some of it is kept so the last word doesn't end abruptly
const SILENCE_RELATIVE = 0.03; // ≈ -30 dB
const SILENCE_FLOOR = 0.001; // -60 dBFS
const KEEP_SILENCE_MS = 500;

/** Where the recording ends once trailing silence is trimmed (never the start: it holds words). */
function soundEnd({ durationMs, peaks }: Analysis): number {
	const loudest = Math.max(0, ...peaks);
	const threshold = Math.max(SILENCE_FLOOR, loudest * SILENCE_RELATIVE);
	let last = peaks.length - 1;
	while (last >= 0 && peaks[last] < threshold) last--;
	// all silence: keep it as it is, the uploader meant something
	if (last < 0) return durationMs;
	return Math.min(durationMs, (last + 1) * BLOCK_MS + KEEP_SILENCE_MS);
}

/** 64 bars of 0–255: the peak of each slice, relative to the loudest, sqrt-scaled. */
function waveform(peaks: number[], endMs: number): number[] {
	const used = peaks.slice(0, Math.max(1, Math.ceil(endMs / BLOCK_MS)));
	const loudest = Math.max(0, ...used);
	const bars: number[] = [];
	for (let i = 0; i < WAVEFORM_BARS; i++) {
		const from = Math.floor((i * used.length) / WAVEFORM_BARS);
		const to = Math.max(from + 1, Math.floor(((i + 1) * used.length) / WAVEFORM_BARS));
		let peak = 0;
		for (let j = from; j < to && j < used.length; j++) peak = Math.max(peak, used[j]);
		bars.push(loudest > 0 ? Math.round(Math.sqrt(peak / loudest) * 255) : 0);
	}
	return bars;
}

async function encode(file: string, out: string, endMs: number) {
	try {
		await run(
			FFMPEG,
			[
				'-nostdin',
				'-v',
				'error',
				'-hide_banner',
				...INPUT,
				'-i',
				fileUrl(file),
				'-map',
				'0:a:0',
				'-vn',
				'-sn',
				'-dn',
				// nothing about the device or the app leaks
				'-map_metadata',
				'-1',
				'-map_chapters',
				'-1',
				'-fflags',
				'+bitexact',
				'-flags:a',
				'+bitexact',
				'-t',
				(endMs / 1000).toFixed(3),
				// single pass, speech levels; loudnorm works at 192 kHz, so it's resampled after
				'-af',
				'loudnorm=I=-16:LRA=11:TP=-1.5,aresample=48000',
				'-ac',
				'1',
				'-ar',
				'48000',
				'-c:a',
				'aac',
				'-b:a',
				'48k',
				'-movflags',
				'+faststart',
				'-f',
				'mp4',
				'-y',
				fileUrl(out)
			],
			{ timeoutMs: timeoutFor(endMs) }
		);
	} catch (e) {
		await fs.promises.rm(out, { force: true });
		if (e instanceof FfmpegError) {
			console.error('audio: encoding failed', e.message);
			throw new AudioError("The recording couldn't be processed");
		}
		throw e;
	}
}

/** What processing found out about a recording. */
export type ProcessedAudio = { duration_ms: number; waveform: number[]; size: number };

// each job holds two ffmpeg processes in turn; the rest wait their turn
const jobs = limitConcurrency(2);

/**
 * Transcodes the recording in `file` to `out` (M4A). Throws AudioError when it can't be used,
 * leaving no `out` behind.
 */
export function processAudio(file: string, out: string): Promise<ProcessedAudio> {
	return jobs(async () => {
		const { durationMs } = await probe(file);
		const analysis = await analyse(file, durationMs);
		if (analysis.durationMs > MAX_AUDIO_MS + GRACE_MS) throw tooLong();
		if (analysis.durationMs < 100) throw new AudioError('The recording is empty');
		const end = Math.min(MAX_AUDIO_MS, soundEnd(analysis));
		await encode(file, out, end);
		const [{ size }, encoded] = await Promise.all([fs.promises.stat(out), probe(out)]);
		// what the file really lasts (AAC works in frames), the cut when it can't be read
		const duration_ms = encoded.durationMs ?? end;
		return { duration_ms, waveform: waveform(analysis.peaks, end), size };
	});
}
