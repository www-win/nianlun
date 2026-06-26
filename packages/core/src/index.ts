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
export { buildReportCopyPrompt, buildFriendAnalysisPrompt } from './ai/prompts'
export { mergeConversations, mergeFriends } from './merge/merge'
