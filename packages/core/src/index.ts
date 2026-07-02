export const version = '0.1.0'

export type {
  Message, Conversation, Friend, ReportData, Relation,
  ParseWarning, ParseResult, Parser,
} from './model/types'

export { createFriend } from './model/friend'
export { parseFile } from './pipeline/parseFile'
export { parseJsonBackup, parseCsvBackup } from './parsers/backup'
export { aggregate } from './stats/aggregate'
export { buildReport } from './stats/report'
export { sumHourly, sumWeekHour, mergeKeywords } from './stats/global'
export { tokenize, countWords } from './stats/segment'
export { buildEgoGraph } from './stats/egoGraph'
export type { EgoNode, EgoGraph } from './stats/egoGraph'
export { buildReportCopyPrompt, buildFriendAnalysisPrompt } from './ai/prompts'
export { buildFriendSentimentPrompt, buildYearSentimentPrompt, parseSentiment, buildFriendDeepSentimentPrompt } from './ai/sentiment'
export type { Sentiment, DeepSentiment, MoodTimelinePoint } from './ai/sentiment'
export { buildFriendProfilePrompt, parseFriendProfile } from './ai/profile'
export type { FriendProfile, InvestmentProfile } from './ai/profile'
export {
  extractFriendSamples, buildFriendSuggestionPrompt, parseFriendSuggestion,
} from './ai/suggestion'
export type { ExtractSamplesOptions, FriendSuggestion } from './ai/suggestion'
export { mergeConversations, mergeFriends, applyContactNames } from './merge/merge'
export { parseWeliveContacts, isWeliveContacts } from './parsers/welive-contacts'
export type { ContactName } from './parsers/welive-contacts'
