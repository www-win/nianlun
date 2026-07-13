export const version = '0.1.0'

export type {
  Message, Conversation, Friend, ReportData, Relation, MbtiCode,
  ParseWarning, ParseResult, Parser,
} from './model/types'

export { createFriend } from './model/friend'
export { parseFile } from './pipeline/parseFile'
export { parseJsonBackup, parseCsvBackup } from './parsers/backup'
export { aggregate } from './stats/aggregate'
export { buildReport, friendReportFields } from './stats/report'
export { sumHourly, sumWeekHour, mergeKeywords } from './stats/global'
export { tokenize, countWords } from './stats/segment'
export { buildEgoGraph } from './stats/egoGraph'
export type { EgoNode, EgoGraph } from './stats/egoGraph'
export { buildReportCopyPrompt, buildFriendAnalysisPrompt } from './ai/prompts'
export { buildFriendSentimentPrompt, buildYearSentimentPrompt, parseSentiment, buildFriendDeepSentimentPrompt } from './ai/sentiment'
export type { Sentiment, DeepSentiment, MoodTimelinePoint } from './ai/sentiment'
export { buildRelationDeepPrompt, parseRelationDeep } from './ai/relationDeep'
export type {
  RelationDeep, AttachmentSide, Trigger, SecurityTurningPoint, Suggestion,
} from './ai/relationDeep'
export { buildFriendProfilePrompt, parseFriendProfile } from './ai/profile'
export type { FriendProfile, InvestmentProfile } from './ai/profile'
export {
  MBTI_CODES, MBTI_TITLES, mbtiTitle, detectMbtiFromText,
  buildMbtiPrompt, parseMbti, effectiveMbtiCode,
} from './ai/mbti'
export type { MbtiAxis, MbtiDimension, MbtiResult, MbtiSource } from './ai/mbti'
export {
  extractFriendSamples, buildFriendSuggestionPrompt, parseFriendSuggestion,
} from './ai/suggestion'
export type { ExtractSamplesOptions, FriendSuggestion } from './ai/suggestion'
export { mergeConversations, mergeFriends, applyContactNames } from './merge/merge'
export { parseWeliveContacts, isWeliveContacts } from './parsers/welive-contacts'
export type { ContactName } from './parsers/welive-contacts'
export { isServiceSession, sessionIdFromFileName } from './parsers/welive'
export { scoreMessage, classify, toValue, wordPolarity } from './stats/emotion'
export type { EmotionDist, MonthMood, FriendEmotion } from './model/types'
export { buildBaziChart } from './astrology/chart'
export { getDayFortune, wuxingRelation } from './astrology/fortune'
export { getCompatibility, isBranchClash, isBranchHarmony, dayBranchClashes } from './astrology/compat'
export type { BirthInfo, BaziChart, DayFortune, Compatibility } from './astrology/types'
export { buildAstroPrompt, parseAstroReading, buildBirthExtractPrompt, parseBirthInfo } from './ai/astro'
export type { AstroReading } from './ai/astro'
export {
  normalizeStockName, parseStockExtraction, mergeStockPicks,
  aggregateByStock, aggregateByRecommender, withRecommenderNames, buildStockExtractionPrompt,
} from './ai/stock'
export type { StockPick, ExtractCtx, StockCard, RecommenderPicks } from './ai/stock'
export {
  selectRelevantFriends, extractKeywords, buildChatQaPrompt, parseChatQaAnswer,
} from './ai/chatQa'
export type { ChatQaTurn, RawExcerpt, ChatQaContext, FriendRef } from './ai/chatQa'
