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
interface EmotionDist {
    happy: number;
    neutral: number;
    sad: number;
    total: number;
    avg: number;
}
interface MonthMood {
    avg: number;
    count: number;
}
interface FriendEmotion {
    me: EmotionDist;
    them: EmotionDist;
    monthly: {
        me: (MonthMood | null)[];
        them: (MonthMood | null)[];
    };
    words: Array<{
        word: string;
        count: number;
        polarity: number;
    }>;
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
    emotion?: FriendEmotion;
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

declare function wordPolarity(word: string): number;
/** 消息原始净分（可正可负，无固定范围）。空串/纯符号 → 0。 */
declare function scoreMessage(text: string): number;
declare function classify(raw: number): '开心' | '平淡' | '难过';
declare function toValue(raw: number): number;

/** 生辰(用户填 / AI 抽取后确认)。公历默认；isLunar 时按农历输入。 */
interface BirthInfo {
    year: number;
    month: number;
    day: number;
    hour?: number;
    isLunar?: boolean;
    gender?: 'male' | 'female';
}
/** 确定性排盘结果。 */
interface BaziChart {
    pillars: {
        year: string;
        month: string;
        day: string;
        hour?: string;
    };
    dayMaster: string;
    fiveElements: Record<string, number>;
    zodiac: string;
    constellation: string;
}
/** 流月/流日：某日期的干支与它对本命日主的生克。 */
interface DayFortune {
    ganzhi: string;
    relation: string;
}
/** 合盘(我 × 好友)：机械判定的刑冲合害。 */
interface Compatibility {
    harmonies: string[];
    clashes: string[];
}

/**
 * 由生辰确定性排八字盘。含时辰则出四柱，缺则只出三柱。
 * 纯函数：不 new Date()、不访问全局，仅依赖 lunar-javascript 计算。
 */
declare function buildBaziChart(birth: BirthInfo): BaziChart;

/**
 * other 相对 base（我）的关系：
 * 比(同) / 生(other 生我) / 泄(我生 other) / 克(other 克我) / 耗(我克 other) / 平(未知)
 */
declare function wuxingRelation(base: string, other: string): string;
/**
 * 某公历日期的当日干支，及其天干五行对本命日主的生克。
 * date 由调用方传入（core 不取系统时间，保证确定可测）。
 */
declare function getDayFortune(date: {
    year: number;
    month: number;
    day: number;
}, chart: BaziChart): DayFortune;

declare function isBranchClash(a: string, b: string): boolean;
declare function isBranchHarmony(a: string, b: string): boolean;
/**
 * 合盘（a=我，b=好友）：以年支（生肖）判六合/相冲，附日主五行生克描述。
 * 纯机械判定，不涉 AI。
 */
declare function getCompatibility(a: BaziChart, b: BaziChart): Compatibility;
/**
 * 今日流日支 是否冲某盘的本命年支/日支。返回相冲描述数组（空=不冲）。
 * dayBranch 为当日干支的地支（流日支）。
 */
declare function dayBranchClashes(dayBranch: string, chart: BaziChart): string[];

interface AstroReading {
    personality?: string;
    fortune?: string;
    affinity?: string;
    advice?: string;
}
/**
 * 命理解读提示词：把「已算好的」结构化盘 + 流日 + 合盘交给 AI，只做自然语言解读。
 * 明确禁止 AI 自己推算干支；无线索填「暂无足够线索」；社交建议软化、娱乐向。
 */
declare function buildAstroPrompt(friend: Friend, chart: BaziChart, dayFortune: DayFortune, compat: Compatibility | null, dayClash?: {
    friend: string[];
    my: string[];
}): string;
/** 容错解析命理解读 JSON：剥围栏、定位花括号、逐字段取非空串；垃圾输入返回 {}，永不抛异常。 */
declare function parseAstroReading(text: string): AstroReading;
/** 抽生辰提示词：从有界样本里找好友透露的出生信息；找不到留空，禁止编造。 */
declare function buildBirthExtractPrompt(friend: Friend, samples: string[]): string;
/** 容错解析生辰：年月日必须有效，否则 null；hour/gender/isLunar 可选。永不抛异常。 */
declare function parseBirthInfo(text: string): BirthInfo | null;

/** 一条荐股原子记录 = 一次「谁推了哪支票」。唯一事实源。 */
interface StockPick {
    stock: string;
    stockNorm: string;
    recommenderId: string;
    recommender: string;
    ts: number;
    targetMarketCap?: string;
    multiple?: string;
    targetTime?: string;
    currentPrice?: string;
    logics: string[];
    companyNotes: string[];
    quote?: string;
}
/** 解析/编排层注入给每条 pick 的上下文。 */
interface ExtractCtx {
    recommenderId: string;
    recommender: string;
    fallbackTs: number;
}
/** 视图A·以票查人：一支票的完整档案。 */
interface StockCard {
    stockNorm: string;
    displayName: string;
    recommenderCount: number;
    pickCount: number;
    latestTargetMarketCap?: string;
    latestMultiple?: string;
    logics: string[];
    companyNotes: string[];
    picks: StockPick[];
}
/** 视图B·以人查票：某人推过的所有票。 */
interface RecommenderPicks {
    recommenderId: string;
    recommender: string;
    stockCount: number;
    picks: StockPick[];
}
/** 归并键规范化：去括号及内容、去空白、英文统一大写。 */
declare function normalizeStockName(raw: string): string;
/** 容错解析 AI 荐股抽取结果为 StockPick[]；注入 ctx；永不抛。 */
declare function parseStockExtraction(text: string, ctx: ExtractCtx): StockPick[];
/** 去重合并两批荐股记录，保持顺序（existing 在前）。 */
declare function mergeStockPicks(existing: StockPick[], incoming: StockPick[]): StockPick[];
/** 视图A：按 stockNorm 聚合成票卡片（三层信息在此归纳）。 */
declare function aggregateByStock(picks: StockPick[]): StockCard[];
/** 视图B：按推荐人聚合。 */
declare function aggregateByRecommender(picks: StockPick[]): RecommenderPicks[];
/** 单个好友 + 带日期样本 → 荐股抽取提示词，要求 AI 只输出严格 JSON 数组。 */
declare function buildStockExtractionPrompt(friend: Friend, samples: string[]): string;

declare const version = "0.1.0";

export { type AstroReading, type BaziChart, type BirthInfo, type Compatibility, type ContactName, type Conversation, type DayFortune, type DeepSentiment, type EgoGraph, type EgoNode, type EmotionDist, type ExtractCtx, type ExtractSamplesOptions, type Friend, type FriendEmotion, type FriendProfile, type FriendSuggestion, type InvestmentProfile, type Message, type MonthMood, type MoodTimelinePoint, type ParseResult, type ParseWarning, type Parser, type RecommenderPicks, type Relation, type ReportData, type Sentiment, type StockCard, type StockPick, aggregate, aggregateByRecommender, aggregateByStock, applyContactNames, buildAstroPrompt, buildBaziChart, buildBirthExtractPrompt, buildEgoGraph, buildFriendAnalysisPrompt, buildFriendDeepSentimentPrompt, buildFriendProfilePrompt, buildFriendSentimentPrompt, buildFriendSuggestionPrompt, buildReport, buildReportCopyPrompt, buildStockExtractionPrompt, buildYearSentimentPrompt, classify, countWords, createFriend, dayBranchClashes, extractFriendSamples, getCompatibility, getDayFortune, isBranchClash, isBranchHarmony, isServiceSession, isWeliveContacts, mergeConversations, mergeFriends, mergeKeywords, mergeStockPicks, normalizeStockName, parseAstroReading, parseBirthInfo, parseCsvBackup, parseFile, parseFriendProfile, parseFriendSuggestion, parseJsonBackup, parseSentiment, parseStockExtraction, parseWeliveContacts, scoreMessage, sessionIdFromFileName, sumHourly, sumWeekHour, toValue, tokenize, version, wordPolarity, wuxingRelation };
