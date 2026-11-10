import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { Fragment, useMemo } from 'react';
import type { TextProps } from 'react-native';
import { auth } from '@/lib/api';
import {
	internalRoute,
	isHttpLink,
	normalizeTag,
	parseHashtag,
	splitMentions,
	unwrapMarkdownImages
} from '@/lib/text';
import { Txt } from './ui';

/** Opens a link: posts, profiles and hashtags of this instance in the app, the rest in a browser. */
export function openLink(url: string) {
	const route = internalRoute(url, auth.server);
	if (route) router.push(route);
	else WebBrowser.openBrowserAsync(url).catch(() => {});
}

type Props = TextProps & { content: string; size?: number; muted?: boolean };

/** Post and message text with its @mentions, #hashtags and links tappable. */
export function RichText({ content, size, muted, ...props }: Props) {
	const parts = useMemo(() => {
		const out: React.ReactNode[] = [];
		const link = (key: number, text: string, onPress: () => void) => (
			<Txt key={key} accent size={size} onPress={onPress} suppressHighlighting>
				{text}
			</Txt>
		);
		unwrapMarkdownImages(content)
			.split(/(\s+)/)
			.forEach((word, i) => {
				if (!word) return;
				if (isHttpLink(word)) {
					out.push(link(i, word.replace(/^https?:\/\//, ''), () => openLink(word)));
					return;
				}
				const hashtag = parseHashtag(word);
				if (hashtag) {
					const tag = encodeURIComponent(normalizeTag(hashtag.tag));
					out.push(
						<Fragment key={i}>
							{link(i, `#${hashtag.tag}`, () => router.push(`/hashtag/${tag}`))}
							{hashtag.rest}
						</Fragment>
					);
					return;
				}
				if (!word.includes('@')) {
					out.push(word);
					return;
				}
				out.push(
					<Fragment key={i}>
						{splitMentions(word).map((part, j) =>
							typeof part === 'string'
								? part
								: link(j, `@${part.username}`, () => router.push(`/user/${part.username}`))
						)}
					</Fragment>
				);
			});
		return out;
	}, [content, size]);
	return (
		<Txt size={size} muted={muted} {...props}>
			{parts}
		</Txt>
	);
}
