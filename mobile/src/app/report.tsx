import { router, useLocalSearchParams } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { Check } from 'lucide-react-native';
import { useState } from 'react';
import { KeyboardAvoidingView, ScrollView, View } from 'react-native';
import { Choice } from '@/components/Choice';
import { Button, ErrorBanner, Field, Hint, Txt } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { REPORT_CATEGORIES, type ReportCategory } from '@/lib/moderation';
import { colors } from '@/lib/theme';

/** Reporting a post (?post=id&username=author) or a profile (?username=) to the staff. */
export default function ReportScreen() {
	const params = useLocalSearchParams<{ post?: string; username: string }>();
	const postId = params.post ? Number(params.post) : null;
	const [category, setCategory] = useState<ReportCategory | null>(null);
	const [details, setDetails] = useState('');
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	// the answer once it is sent: the screen then thanks
	const [sent, setSent] = useState<string | null>(null);
	const title = postId ? 'Report post' : `Report @${params.username}`;

	async function submit() {
		if (!category || busy) return;
		if (category === 'other' && !details.trim()) {
			setError('Tell the staff what is wrong.');
			return;
		}
		setBusy(true);
		setError(null);
		try {
			const res = await api<{ message: string }>('reports', {
				method: 'POST',
				body: {
					...(postId ? { post_id: postId } : { username: params.username }),
					category,
					details: details.trim()
				}
			});
			setSent(res.message);
		} catch (e) {
			setError(errorMessage(e));
		} finally {
			setBusy(false);
		}
	}

	if (sent)
		return (
			<View style={{ flex: 1, padding: 20, paddingTop: 60, alignItems: 'center', gap: 12 }}>
				<Stack.Screen options={{ title }} />
				<View
					style={{
						width: 44,
						height: 44,
						borderRadius: 22,
						backgroundColor: colors.accent,
						alignItems: 'center',
						justifyContent: 'center'
					}}
				>
					<Check size={24} strokeWidth={3} color={colors.background} />
				</View>
				<Txt extrabold size={18}>
					Report sent
				</Txt>
				<Txt muted style={{ textAlign: 'center' }}>
					{sent}
				</Txt>
				<Button
					label="Done"
					style={{ alignSelf: 'stretch', marginTop: 10 }}
					onPress={router.back}
				/>
			</View>
		);

	return (
		<KeyboardAvoidingView behavior="padding" style={{ flex: 1 }} keyboardVerticalOffset={90}>
			<Stack.Screen options={{ title }} />
			<ScrollView
				contentContainerStyle={{ padding: 20, gap: 20, paddingBottom: 40 }}
				keyboardShouldPersistTaps="handled"
			>
				<Hint>Only the staff see reports. @{params.username} isn’t told who reported.</Hint>
				<ErrorBanner message={error} />
				<View style={{ gap: 5 }}>
					<Txt size={13} dim={0.8} style={{ marginBottom: 5 }}>
						What’s wrong?
					</Txt>
					{REPORT_CATEGORIES.map((c) => (
						<Choice
							key={c.value}
							label={c.label}
							hint={c.hint}
							selected={category === c.value}
							onPress={() => setCategory(c.value)}
						/>
					))}
				</View>
				<Field
					label={`Anything the staff should know?${category === 'other' ? '' : ' (optional)'}`}
					value={details}
					onChangeText={setDetails}
					maxLength={1000}
					multiline
					autoCapitalize="sentences"
					style={{ minHeight: 80, textAlignVertical: 'top' }}
				/>
				<View style={{ flexDirection: 'row', gap: 10 }}>
					<Button label="Cancel" style={{ flex: 1 }} onPress={router.back} />
					<Button
						label="Report"
						variant="danger"
						style={{ flex: 1 }}
						disabled={!category}
						loading={busy}
						onPress={submit}
					/>
				</View>
			</ScrollView>
		</KeyboardAvoidingView>
	);
}
