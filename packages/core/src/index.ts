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
export { buildEgoGraph } from './stats/egoGraph'
export type { EgoNode, EgoGraph } from './stats/egoGraph'
export { buildReportCopyPrompt, buildFriendAnalysisPrompt } from './ai/prompts'
export {
  extractFriendSamples, buildFriendSuggestionPrompt, parseFriendSuggestion,
} from './ai/suggestion'
export type { ExtractSamplesOptions, FriendSuggestion } from './ai/suggestion'
export { mergeConversations, mergeFriends } from './merge/merge'
