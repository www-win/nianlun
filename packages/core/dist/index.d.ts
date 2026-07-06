type Relation = '家人' | '挚友' | '同事' | '同学' | '客户' | '其他';
interface Message {
    ts: number;
    from: 'me' | 'them';
    type: 'text' | 'image' | 'voice' | 'video' | 'system' | 'other';
    text?: string;
}
interface Conversation {
    id: string;
    peerName: string;
    isGroup: boolean;
    messages: Message[];
}
interface Friend {
    id: string;
    name: string;
    alias: string;
    rel: Relation;
    role: string;
    firstContact: number;
    lastContact: number;
    msgCount: number;
    sentRatio: number;
    peakPeriod: string;
    maxStreak: number;
    monthly: number[];
    hourly: number[];
    weekHour: number[];
    keywords: Array<{
        word: string;
        count: number;
    }>;
    userEdited: {
        role?: string;
        rel?: Relation;
        alias?: string;
        name?: string;
    };
}
interface ReportData {
    year: number;
    totalMessages: number;
    friendCount: number;
    activeDays: number;
    topContacts: Array<{
        friendId: string;
        msgCount: number;
    }>;
    latestMessage: {
        ts: number;
        friendId: string;
    } | null;
    keywords: Array<{
        word: string;
        count: number;
    }>;
    relationBreakdown: Array<{
        rel: Relation;
        percent: number;
    }>;
}
interface ParseWarning {
    line?: number;
    reason: string;
}
interface ParseResult {
    conversations: Conversation[];
    warnings: ParseWarning[];
}
interface Parser {
    name: string;
    canParse(fileName: string, sample: string): boolean;
    parse(content: string, onProgress?: (p: number) => void, fileName?: string): ParseResult;
}

declare function createFriend(id: string, name: string): Friend;

declare function parseFile(fileName: string, content: string, onProgress?: (p: number) => void): ParseResult;

declare function parseJsonBackup(content: string): Friend[];
declare function parseCsvBackup(content: string): Friend[];

declare function aggregate(conversations: Conversation[]): Friend[];

declare function buildReport(conversations: Conversation[], friends: Friend[], year: number): ReportData;

declare function sumHourly(friends: Friend[]): number[];
declare function sumWeekHour(friends: Friend[]): number[];
declare function mergeKeywords(friends: Friend[], topN: number): Array<{
    word: string;
    count: number;
}>;

declare function tokenize(text: string): string[];
declare function countWords(texts: Iterable<string>, topN: number): Array<{
    word: string;
    count: number;
}>;

interface EgoNode {
    id: string;
    name: string;
    rel: Relation;
    angle: number;
    radiusFraction: number;
    sizeFraction: number;
    msgCount: number;
}
interface EgoGraph {
    nodes: EgoNode[];
}
declare function buildEgoGraph(friends: Friend[]): EgoGraph;

declare function buildReportCopyPrompt(report: ReportData, friends: Friend[]): string;
declare function buildFriendAnalysisPrompt(friend: Friend): string;

interface Sentiment {
    tone?: string;
    summary?: string;
}
/**
 * 单个好友的情绪分析提示词：依据聚合统计 + 有界样本，要求 AI 输出严格 JSON。
 * tone 为一个具体、生动的情绪基调短词（鼓励多样，非固定档位）。
 */
declare function buildFriendSentimentPrompt(friend: Friend, samples: string[]): string;
/**
 * 全年整体社交情绪提示词：依据年度聚合 + 跨好友样本，写一段中文描述。
 */
declare function buildYearSentimentPrompt(report: ReportData, sampleLines: string[]): string;
/**
 * 容错解析情绪 JSON：剥围栏、定位首个 JSON、取 tone/summary；无法解析返回 {}，永不抛异常。
 */
declare function parseSentiment(text: string): Sentiment;
interface MoodTimelinePoint {
    m: number;
    score: number | null;
}
interface DeepSentiment {
    tone?: string;
    summary?: string;
    timeline?: MoodTimelinePoint[];
    me?: Sentiment;
    them?: Sentiment;
}
/**
 * 深度情绪提示词：在整体基调之外，额外要求逐月情绪走势(timeline)与「我/对方」各自情绪。
 * 逐月消息数写入 prompt，提示 AI 对无往来月给 null，不要编造。
 */
declare function buildFriendDeepSentimentPrompt(friend: Friend, samples: string[]): string;

interface InvestmentProfile {
    summary?: string;
    risk?: string;
    categories?: string;
    wealth?: string;
    style?: string;
}
interface FriendProfile {
    identity?: string;
    family?: string;
    romance?: string;
    lifestyle?: string;
    investment?: InvestmentProfile;
}
/**
 * 好友画像提示词：依据聚合统计 + 有界样本，要求 AI 输出严格 JSON。
 * 5 个侧面（身份/家庭/感情/生活/投资），每字段一小段简述；无线索填「暂无足够线索」。
 */
declare function buildFriendProfilePrompt(friend: Friend, samples: string[]): string;
/**
 * 容错解析好友画像 JSON：剥围栏、定位首尾花括号、逐字段取非空字符串；
 * investment 内部全空则省略整块。无法解析返回 {}，永不抛异常。
 */
declare function parseFriendProfile(text: string): FriendProfile;

interface ExtractSamplesOptions {
    /** 每个好友最多保留的样本条数（默认 30） */
    maxPerFriend?: number;
    /** 单条文本截断到的最大字符数（默认 80） */
    maxChars?: number;
}
/**
 * 从会话里截取每个好友的有界消息样本，供 AI 推断关系/职务。
 * 纯函数：键为会话 id（= Friend.id），值为带收发方向标注的文本片段数组。
 * 仅取非空的 text 消息；超出条数上限时按时间均匀采样以兼顾早晚。
 */
declare function extractFriendSamples(conversations: Conversation[], opts?: ExtractSamplesOptions): Record<string, string[]>;
/**
 * 单个好友 + 消息样本 → 提示词，要求 AI 只输出严格 JSON。
 */
declare function buildFriendSuggestionPrompt(friend: Friend, samples: string[]): string;
interface FriendSuggestion {
    rel?: Relation;
    role?: string;
    reason?: string;
}
/**
 * 解析 AI 返回文本为结构化建议。容错：剥除围栏与多余文字、定位首个 JSON、
 * 校验 rel 合法性、trim role/reason。完全无法解析时返回 {}，永不抛异常。
 */
declare function parseFriendSuggestion(text: string): FriendSuggestion;

declare function mergeConversations(a: Conversation[], b: Conversation[]): Conversation[];
declare function mergeFriends(existing: Friend[], incoming: Friend[]): {
    friends: Friend[];
    added: number;
    updated: number;
};
declare function applyContactNames(friends: Friend[], names: Array<{
    id: string;
    name: string;
}>): Friend[];

interface ContactName {
    id: string;
    name: string;
}
declare function isWeliveContacts(sample: string): boolean;
declare function parseWeliveContacts(content: string): ContactName[];

declare function sessionIdFromFileName(fileName: string): string;
declare function isServiceSession(sessionId: string): boolean;

declare const version = "0.1.0";

export { type ContactName, type Conversation, type DeepSentiment, type EgoGraph, type EgoNode, type ExtractSamplesOptions, type Friend, type FriendProfile, type FriendSuggestion, type InvestmentProfile, type Message, type MoodTimelinePoint, type ParseResult, type ParseWarning, type Parser, type Relation, type ReportData, type Sentiment, aggregate, applyContactNames, buildEgoGraph, buildFriendAnalysisPrompt, buildFriendDeepSentimentPrompt, buildFriendProfilePrompt, buildFriendSentimentPrompt, buildFriendSuggestionPrompt, buildReport, buildReportCopyPrompt, buildYearSentimentPrompt, countWords, createFriend, extractFriendSamples, isServiceSession, isWeliveContacts, mergeConversations, mergeFriends, mergeKeywords, parseCsvBackup, parseFile, parseFriendProfile, parseFriendSuggestion, parseJsonBackup, parseSentiment, parseWeliveContacts, sessionIdFromFileName, sumHourly, sumWeekHour, tokenize, version };
