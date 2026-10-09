/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import * as vscode from 'vscode';

interface BibleVerse {
	reference: string;
	text: string;
	bibleVersionAbbreviation?: string;
}

interface BibleMetadata {
	abbreviation?: string;
}

interface VerseSelection {
	passageId: string;
	reference: string;
	fallbackText: string;
}

interface BibleIndex {
	books?: BibleIndexBook[];
}

interface BibleIndexBook {
	chapters?: BibleIndexChapter[];
}

interface BibleIndexChapter {
	verses?: BibleIndexVerse[];
}

interface BibleIndexVerse {
	passage_id?: string;
}

type VerseMode = 'random' | 'sequential';
type StatusBarClickAction = 'showVerse' | 'newRandomVerse';
type VerseRefreshMode = 'onVSCodeOpen' | 'schedule';

const defaultBibleId = '3034';
const fallbackBibleId = '3034';

const versePool: VerseSelection[] = [
	{ passageId: 'JHN.3.16', reference: 'John 3:16', fallbackText: 'For God so loved the world that He gave His one and only Son, that everyone who believes in Him shall not perish but have eternal life.' },
	{ passageId: 'PSA.23.1', reference: 'Psalm 23:1', fallbackText: 'The Lord is my shepherd; I shall not want.' },
	{ passageId: 'PRO.3.5', reference: 'Proverbs 3:5-6', fallbackText: 'Trust in the Lord with all your heart, and lean not on your own understanding; in all your ways acknowledge Him, and He will make your paths straight.' },
	{ passageId: 'ROM.8.28', reference: 'Romans 8:28', fallbackText: 'And we know that God works all things together for the good of those who love Him, who are called according to His purpose. ' },
	{ passageId: 'PHP.4.13', reference: 'Philippians 4:13', fallbackText: 'I can do all things through Christ who gives me strength.' },
	{ passageId: 'ISA.40.31', reference: 'Isaiah 40:31', fallbackText: 'But those who wait upon the Lord will renew their strength; they will mount up with wings like eagles; they will run and not grow weary, they will walk and not faint.' },
	{ passageId: 'JOS.1.9', reference: 'Joshua 1:9', fallbackText: 'Have I not commanded you to be strong and courageous? Do not be afraid; do not be discouraged, for the Lord your God is with you wherever you go.' },
	{ passageId: 'HEB.11.1', reference: 'Hebrews 11:1', fallbackText: 'Now faith is the assurance of what we hope for and the certainty of what we do not see.' },
	{ passageId: '1CO.16.14', reference: '1 Corinthians 16:14', fallbackText: 'Do everything in love.' },
	{ passageId: 'MAT.6.33', reference: 'Matthew 6:33', fallbackText: 'But seek first the kingdom of God and His righteousness, and all these things will be added unto you. ' },
	{ passageId: 'PSA.46.10', reference: 'Psalm 46:10', fallbackText: 'Be still and know that I am God; I will be exalted among the nations, I will be exalted over the earth.' },
	{ passageId: 'ROM.12.2', reference: 'Romans 12:2', fallbackText: 'All who sin apart from the law will also perish apart from the law, and all who sin under the law will be judged by the law.' }
];

let statusBarItem: vscode.StatusBarItem;
let currentVerseIndex = -1;
let currentVerse: BibleVerse | undefined;
let secretStorage: vscode.SecretStorage;
let cachedBibleIndex: { bibleId: string; passageIds: string[] } | undefined;
let refreshInterval: ReturnType<typeof setInterval> | undefined;
const bibleVersionAbbreviations = new Map<string, string>();

export function activate(context: vscode.ExtensionContext) {
	const { subscriptions } = context;
	secretStorage = context.secrets;

	subscriptions.push(vscode.commands.registerCommand('bibleVerse.showVerse', () => {
		showCurrentVerseNotification();
	}));
	subscriptions.push(vscode.commands.registerCommand('bibleVerse.statusBarClick', () => {
		const clickAction = vscode.workspace.getConfiguration('bibleVerse').get<StatusBarClickAction>('clickAction', 'showVerse');
		if (clickAction === 'newRandomVerse') {
			void updateStatusBarItem(true, true);
			return;
		}

		showCurrentVerseNotification();
	}));

	subscriptions.push(vscode.commands.registerCommand('bibleVerse.refreshVerse', () => {
		void updateStatusBarItem(true);
	}));

	subscriptions.push(vscode.commands.registerCommand('bibleVerse.setAppKey', async () => {
		const key = await vscode.window.showInputBox({
			prompt: 'Enter your YouVersion API app key',
			placeHolder: 'Paste the app key here',
			ignoreFocusOut: true,
			password: true
		});

		if (key && key.trim()) {
			await secretStorage.store('bibleVerse.appKey', key.trim());
			void vscode.window.showInformationMessage('YouVersion app key stored securely.');
			void updateStatusBarItem(true);
		}
	}));

	subscriptions.push(vscode.commands.registerCommand('bibleVerse.clearAppKey', async () => {
		await secretStorage.delete('bibleVerse.appKey');
		void vscode.window.showInformationMessage('YouVersion app key cleared.');
		void updateStatusBarItem(true);
	}));

	statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
	statusBarItem.name = 'Bible Verse';
	statusBarItem.command = 'bibleVerse.statusBarClick';
	subscriptions.push(statusBarItem);
	updateRefreshSchedule();
	subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => {
		if (event.affectsConfiguration('bibleVerse.refreshMode') || event.affectsConfiguration('bibleVerse.refreshFrequency')) {
			updateRefreshSchedule();
		}
		void updateStatusBarItem(true);
	}));

	void updateStatusBarItem(true);
}

export function deactivate(): void {
	if (refreshInterval !== undefined) {
		clearInterval(refreshInterval);
		refreshInterval = undefined;
	}
	statusBarItem?.dispose();
}

function showCurrentVerseNotification(): void {
	if (!currentVerse) {
		return;
	}

	void vscode.window.showInformationMessage(`${currentVerse.reference}\n${currentVerse.text}`);
}

function updateRefreshSchedule(): void {
	if (refreshInterval !== undefined) {
		clearInterval(refreshInterval);
		refreshInterval = undefined;
	}

	const config = vscode.workspace.getConfiguration('bibleVerse');
	const refreshMode = config.get<VerseRefreshMode>('refreshMode', 'onVSCodeOpen');
	if (refreshMode !== 'schedule') {
		return;
	}

	const frequencyMinutes = Math.max(1, config.get<number>('refreshFrequency', 60));
	refreshInterval = setInterval(() => {
		void updateStatusBarItem(true);
	}, frequencyMinutes * 60 * 1000);
}

async function updateStatusBarItem(forceRefresh = false, forceRandom = false): Promise<void> {
	const config = vscode.workspace.getConfiguration('bibleVerse');
	const displayFullVerse = config.get<boolean>('displayFullVerse', true);
	const statusBarWidth = Math.max(40, config.get<number>('statusBarWidth', 200));
	const shrinkToFit = config.get<boolean>('shrinkToFit', true);
	const showBibleVersionInTooltip = config.get<boolean>('showBibleVersionInTooltip', true);
	const verseMode = config.get<VerseMode>('randomOrSequential', 'random');
	const verse = await getNextVerse(verseMode, forceRefresh, forceRandom);
	currentVerse = verse;

	const label = buildStatusLabel(verse, displayFullVerse, statusBarWidth, shrinkToFit);
	statusBarItem.text = label;
	const versionSuffix = showBibleVersionInTooltip && verse.bibleVersionAbbreviation
		? ` (${verse.bibleVersionAbbreviation})`
		: '';
	statusBarItem.tooltip = new vscode.MarkdownString(`**${verse.reference}${versionSuffix}**\n\n${verse.text}`);
	statusBarItem.show();
}

async function getNextVerse(mode: VerseMode, forceRefresh: boolean, forceRandom: boolean): Promise<BibleVerse> {
	if (versePool.length === 0) {
		return { reference: 'No verse available', text: 'No verse data is available.' };
	}

	if (forceRandom || mode === 'random') {
		let nextIndex = Math.floor(Math.random() * versePool.length);
		while (nextIndex === currentVerseIndex && versePool.length > 1) {
			nextIndex = Math.floor(Math.random() * versePool.length);
		}
		currentVerseIndex = nextIndex;
	} else {
		currentVerseIndex = (currentVerseIndex + 1) % versePool.length;
	}

	if (forceRefresh && mode === 'random' && !forceRandom) {
		let nextIndex = Math.floor(Math.random() * versePool.length);
		while (nextIndex === currentVerseIndex && versePool.length > 1) {
			nextIndex = Math.floor(Math.random() * versePool.length);
		}
		currentVerseIndex = nextIndex;
	}

	const selection = versePool[currentVerseIndex];
	const config = vscode.workspace.getConfiguration('bibleVerse');
	const appKey = (await secretStorage.get('bibleVerse.appKey'))?.trim() || config.get<string>('appKey', '').trim();
	const bibleId = config.get<string>('bibleId', defaultBibleId).trim() || defaultBibleId;
	const fallbackVerse = {
		reference: selection.reference,
		text: selection.fallbackText,
		bibleVersionAbbreviation: 'KJV'
	};

	if (!appKey) {
		return fallbackVerse;
	}

	const bibleIds = bibleId === fallbackBibleId ? [bibleId] : [bibleId, fallbackBibleId];
	for (const candidateBibleId of bibleIds) {
		try {
			const catalogVerse = await fetchYouVersionVerseFromCatalog(candidateBibleId, appKey);
			if (catalogVerse) {
				return catalogVerse;
			}
		} catch (error) {
			console.warn(`YouVersion Bible index request failed for ${candidateBibleId}.`, error);
		}

		try {
			const passageVerse = await fetchYouVersionVerse(selection.passageId, candidateBibleId, appKey);
			if (passageVerse) {
				return passageVerse;
			}
		} catch (error) {
			console.warn(`YouVersion passage request failed for ${candidateBibleId}.`, error);
		}
	}

	return fallbackVerse;
}

async function fetchYouVersionVerse(passageId: string, bibleId: string, appKey: string): Promise<BibleVerse | undefined> {
	const url = `https://api.youversion.com/v1/bibles/${bibleId}/passages/${encodeURIComponent(passageId)}`;
	const data = await fetchYouVersionJson<{ reference?: string; content?: string }>(url, appKey);
	const text = normalizeVerseText(data.content ?? '');
	if (!data.reference || !text) {
		return undefined;
	}

	return {
		reference: data.reference,
		text,
		bibleVersionAbbreviation: await getBibleVersionAbbreviation(bibleId, appKey)
	};
}

async function getBibleVersionAbbreviation(bibleId: string, appKey: string): Promise<string> {
	const cachedAbbreviation = bibleVersionAbbreviations.get(bibleId);
	if (cachedAbbreviation) {
		return cachedAbbreviation;
	}

	try {
		const metadata = await fetchYouVersionJson<BibleMetadata>(`https://api.youversion.com/v1/bibles/${encodeURIComponent(bibleId)}`, appKey);
		const abbreviation = metadata.abbreviation?.trim();
		if (abbreviation) {
			bibleVersionAbbreviations.set(bibleId, abbreviation);
			return abbreviation;
		}
	} catch (error) {
		console.warn(`YouVersion Bible metadata request failed for ${bibleId}.`, error);
	}

	if (bibleId === defaultBibleId) {
		return 'NIV';
	}

	return bibleId === fallbackBibleId ? 'BSB' : bibleId;
}

async function fetchYouVersionVerseFromCatalog(bibleId: string, appKey: string): Promise<BibleVerse | undefined> {
	if (!cachedBibleIndex || cachedBibleIndex.bibleId !== bibleId) {
		const index = await fetchYouVersionJson<BibleIndex>(`https://api.youversion.com/v1/bibles/${bibleId}/index`, appKey);
		const passageIds = (index.books ?? []).flatMap(book =>
			(book.chapters ?? []).flatMap(chapter =>
				(chapter.verses ?? [])
					.map(verse => verse.passage_id)
					.filter((passageId): passageId is string => Boolean(passageId))
			)
		);

		if (passageIds.length === 0) {
			return undefined;
		}

		cachedBibleIndex = { bibleId, passageIds };
	}

	return fetchYouVersionVerse(pickRandomItem(cachedBibleIndex.passageIds), bibleId, appKey);
}

async function fetchYouVersionJson<T>(url: string, appKey: string): Promise<T> {
	const response = await fetch(url, {
		headers: {
			Accept: 'application/json',
			'X-YVP-App-Key': appKey
		}
	});

	if (!response.ok) {
		throw new Error(`YouVersion request failed: ${response.status} ${response.statusText} (${new URL(url).pathname})`);
	}

	return await response.json() as T;
}

function pickRandomItem<T>(items: T[]): T {
	return items[Math.floor(Math.random() * items.length)];
}

function normalizeVerseText(content: string): string {
	return content
		.replace(/<[^>]*>/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function buildStatusLabel(verse: BibleVerse, displayFullVerse: boolean, width: number, shrinkToFit: boolean): string {
	const content = displayFullVerse ? `${verse.reference}: ${verse.text}` : verse.reference;
	const compactText = content.replace(/\s+/g, ' ').trim();
	const truncated = truncateToWidth(compactText, width);
	const padding = shrinkToFit ? '' : padToWidth(truncated, width);
	return `$(book) ${truncated}${padding}`;
}

function truncateToWidth(text: string, width: number): string {
	if (text.length <= width) {
		return text;
	}
	if (width <= 3) {
		return '.'.repeat(width);
	}
	return `${text.slice(0, width - 3)}...`;
}

function padToWidth(text: string, width: number): string {
	if (text.length >= width) {
		return '';
	}
	return '\u00A0'.repeat(width - text.length);
}
