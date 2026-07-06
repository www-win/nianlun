// src/model/friend.ts
function createFriend(id, name) {
  return {
    id,
    name,
    alias: "",
    rel: "\u5176\u4ED6",
    role: "",
    firstContact: 0,
    lastContact: 0,
    msgCount: 0,
    sentRatio: 0,
    peakPeriod: "",
    maxStreak: 0,
    monthly: new Array(12).fill(0),
    hourly: new Array(24).fill(0),
    weekHour: new Array(168).fill(0),
    keywords: [],
    userEdited: {}
  };
}

// src/parsers/txt.ts
var HEADER = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) (.+)$/;
var txtParser = {
  name: "txt",
  canParse(fileName, sample) {
    if (fileName.toLowerCase().endsWith(".txt")) return true;
    return sample.split(/\r?\n/).some((l) => HEADER.test(l));
  },
  parse(content, onProgress) {
    const lines = content.split(/\r?\n/);
    const messages = [];
    const warnings = [];
    let peerName = "";
    let cur = null;
    const flush = () => {
      if (cur) {
        messages.push({ ts: cur.ts, from: cur.from, type: "text", text: cur.body.join("\n").trim() });
        cur = null;
      }
    };
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const m = HEADER.exec(line);
      if (m) {
        flush();
        const sender = m[2].trim();
        const from = sender === "\u6211" ? "me" : "them";
        if (from === "them" && !peerName) peerName = sender;
        cur = { ts: new Date(m[1].replace(" ", "T")).getTime(), from, body: [] };
      } else if (cur) {
        if (line.trim() !== "") cur.body.push(line);
      } else if (line.trim() !== "") {
        warnings.push({ line: i + 1, reason: "\u65E0\u6CD5\u8BC6\u522B\u7684\u884C,\u5DF2\u8DF3\u8FC7" });
      }
      if (onProgress && lines.length) onProgress((i + 1) / lines.length);
    }
    flush();
    const conv = {
      id: peerName || "unknown",
      peerName: peerName || "\u672A\u77E5\u8054\u7CFB\u4EBA",
      isGroup: false,
      messages
    };
    return { conversations: messages.length ? [conv] : [], warnings };
  }
};

// src/parsers/html.ts
var MSG = /<div class="msg"([^>]*)>([\s\S]*?)<\/div>/g;
var ATTR = (attrs, name) => {
  const m = new RegExp(`${name}="([^"]*)"`).exec(attrs);
  return m ? m[1] : "";
};
var stripTags = (s) => s.replace(/<[^>]+>/g, "").trim();
var htmlParser = {
  name: "html",
  canParse(fileName, sample) {
    if (fileName.toLowerCase().endsWith(".html") || fileName.toLowerCase().endsWith(".htm")) return true;
    return /<!doctype html|<html/i.test(sample);
  },
  parse(content, onProgress) {
    const messages = [];
    const warnings = [];
    let peerName = "";
    let m;
    MSG.lastIndex = 0;
    while ((m = MSG.exec(content)) !== null) {
      const attrs = m[1];
      const from = ATTR(attrs, "data-from") === "me" ? "me" : "them";
      const name = ATTR(attrs, "data-name");
      const tsRaw = ATTR(attrs, "data-ts");
      const ts = tsRaw ? new Date(tsRaw).getTime() : 0;
      if (Number.isNaN(ts)) {
        warnings.push({ reason: `\u65E0\u6CD5\u89E3\u6790\u65F6\u95F4:${tsRaw}` });
        continue;
      }
      if (from === "them" && name && !peerName) peerName = name;
      messages.push({ ts, from, type: "text", text: stripTags(m[2]) });
    }
    if (onProgress) onProgress(1);
    const conv = {
      id: peerName || "unknown",
      peerName: peerName || "\u672A\u77E5\u8054\u7CFB\u4EBA",
      isGroup: false,
      messages
    };
    return { conversations: messages.length ? [conv] : [], warnings };
  }
};

// src/parsers/weflow.ts
var F = {
  messages: ["messages", "msgList", "data"],
  ts: ["createTime", "CreateTime", "create_time", "timestamp"],
  isSender: ["isSender", "IsSender", "is_sender", "isSelf"],
  type: ["type", "Type", "msgType", "MsgType"],
  text: ["content", "StrContent", "msg", "message"],
  talker: ["talker", "wxid", "userName", "UserName"],
  peerName: ["nickName", "nickname", "talkerName", "remark"],
  isGroup: ["isChatroom", "isGroup", "is_chatroom"]
};
var TYPE_MAP = {
  1: "text",
  3: "image",
  34: "voice",
  43: "video",
  1e4: "system",
  10002: "system"
};
function pick(obj, keys) {
  if (!obj || typeof obj !== "object") return void 0;
  for (const k of keys) {
    const v = obj[k];
    if (v !== void 0 && v !== null) return v;
  }
  return void 0;
}
function toMs(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n < 1e12 ? n * 1e3 : n;
}
function mapType(raw) {
  return TYPE_MAP[Number(raw)] ?? "other";
}
function mapWeflowMessages(raw) {
  const warnings = [];
  const obj = raw;
  const rawMsgs = pick(obj, F.messages);
  if (!Array.isArray(rawMsgs)) {
    return { conversations: [], warnings: [{ reason: "\u672A\u627E\u5230\u6D88\u606F\u6570\u7EC4" }] };
  }
  const talker = String(pick(obj, F.talker) ?? "") || "unknown";
  const peerName = String(pick(obj, F.peerName) ?? "") || "\u672A\u77E5\u8054\u7CFB\u4EBA";
  const isGroup = Boolean(pick(obj, F.isGroup)) || talker.endsWith("@chatroom");
  const messages = [];
  rawMsgs.forEach((rm, i) => {
    const r = rm;
    const ts = toMs(pick(r, F.ts));
    if (!ts) {
      warnings.push({ line: i + 1, reason: "\u6D88\u606F\u7F3A\u5C11\u6709\u6548\u65F6\u95F4,\u5DF2\u8DF3\u8FC7" });
      return;
    }
    const from = Number(pick(r, F.isSender)) === 1 ? "me" : "them";
    messages.push({ ts, from, type: mapType(pick(r, F.type)), text: String(pick(r, F.text) ?? "") });
  });
  const conv = { id: talker, peerName, isGroup, messages };
  return { conversations: messages.length ? [conv] : [], warnings };
}
var weflowParser = {
  name: "weflow",
  canParse(_fileName, sample) {
    const s = sample.replace(/^﻿/, "").trimStart();
    if (!s.startsWith("{")) return false;
    const hasMsgArray = /"(messages|msgList|data)"\s*:\s*\[/.test(s);
    const hasMsgField = /"(createTime|CreateTime|isSender|IsSender)"/.test(s);
    return hasMsgArray && hasMsgField;
  },
  parse(content, onProgress) {
    let raw;
    try {
      raw = JSON.parse(content.replace(/^﻿/, ""));
    } catch {
      return { conversations: [], warnings: [{ reason: "JSON \u89E3\u6790\u5931\u8D25" }] };
    }
    const result = mapWeflowMessages(raw);
    if (onProgress) onProgress(1);
    return result;
  }
};

// src/parsers/welive.ts
var SERVICE_IDS = /* @__PURE__ */ new Set([
  "filehelper",
  "weixin",
  "notifymessage",
  "brandsessionholder",
  "brandservicesessionholder",
  "fmessage",
  "floatbottle",
  "qmessage",
  "medianote",
  "newsapp"
]);
var TYPE_MAP2 = {
  1: "text",
  3: "image",
  34: "voice",
  43: "video",
  1e4: "system",
  10002: "system"
};
function sessionIdFromFileName(fileName) {
  const base = fileName.replace(/\.[^.]+$/, "");
  const m = base.match(/^(.*)_[0-9a-f]{8}$/i);
  return m ? m[1] : base;
}
function isServiceSession(sessionId) {
  return sessionId.startsWith("gh_") || SERVICE_IDS.has(sessionId);
}
function toMs2(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n < 1e12 ? n * 1e3 : n;
}
function baseType(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  return n % 4294967296;
}
var weliveParser = {
  name: "welive",
  canParse(_fileName, sample) {
    const firstLine = sample.replace(/^﻿/, "").split(/\r?\n/).find((l) => l.trim());
    if (!firstLine) return false;
    const s = firstLine.trim();
    if (!s.startsWith("{")) return false;
    return s.includes('"sort_seq"') && s.includes('"create_time"') && s.includes('"local_type"');
  },
  parse(content, onProgress, fileName = "") {
    const warnings = [];
    const sessionId = sessionIdFromFileName(fileName) || "unknown";
    if (isServiceSession(sessionId)) {
      if (onProgress) onProgress(1);
      return { conversations: [], warnings: [] };
    }
    const isGroup = sessionId.endsWith("@chatroom");
    const messages = [];
    const lines = content.replace(/^﻿/, "").split(/\r?\n/);
    lines.forEach((line, i) => {
      const t = line.trim();
      if (!t) return;
      let r;
      try {
        r = JSON.parse(t);
      } catch {
        warnings.push({ line: i + 1, reason: "JSON \u884C\u89E3\u6790\u5931\u8D25,\u5DF2\u8DF3\u8FC7" });
        return;
      }
      const ts = toMs2(r.create_time);
      if (!ts) {
        warnings.push({ line: i + 1, reason: "\u6D88\u606F\u7F3A\u5C11\u6709\u6548\u65F6\u95F4,\u5DF2\u8DF3\u8FC7" });
        return;
      }
      const bt = baseType(r.local_type);
      const type = TYPE_MAP2[bt] ?? "other";
      const sender = String(r.sender_username ?? "");
      const from = bt >= 1e4 ? "them" : isGroup ? sender === "" ? "me" : "them" : sender === sessionId ? "them" : "me";
      let text = "";
      if (type === "text") {
        text = String(r.message_content ?? "");
        if (isGroup && sender) {
          const prefix = `${sender}:
`;
          if (text.startsWith(prefix)) text = text.slice(prefix.length);
        }
      }
      messages.push({ ts, from, type, text });
    });
    if (onProgress) onProgress(1);
    const conv = { id: sessionId, peerName: sessionId, isGroup, messages };
    return { conversations: messages.length ? [conv] : [], warnings };
  }
};

// src/pipeline/parseFile.ts
var PARSERS = [weflowParser, weliveParser, htmlParser, txtParser];
function parseFile(fileName, content, onProgress) {
  const sample = content.slice(0, 2e3);
  const parser = PARSERS.find((p) => p.canParse(fileName, sample));
  if (!parser) {
    return { conversations: [], warnings: [{ reason: `\u65E0\u6CD5\u8BC6\u522B\u7684\u6587\u4EF6\u683C\u5F0F:${fileName}` }] };
  }
  return parser.parse(content, onProgress, fileName);
}

// src/parsers/backup.ts
var RELATIONS = ["\u5BB6\u4EBA", "\u631A\u53CB", "\u540C\u4E8B", "\u540C\u5B66", "\u5BA2\u6237", "\u5176\u4ED6"];
var toRel = (s) => RELATIONS.includes(s) ? s : "\u5176\u4ED6";
function applyRecord(rec) {
  const name = String(rec.name ?? rec["\u6635\u79F0"] ?? "");
  const f = createFriend(name || "unknown", name);
  f.alias = String(rec.alias ?? rec["\u5907\u6CE8"] ?? "");
  f.rel = toRel(String(rec.rel ?? rec["\u5173\u7CFB"] ?? "\u5176\u4ED6"));
  f.role = String(rec.role ?? rec["\u804C\u52A1"] ?? "");
  f.msgCount = Number(rec.msgCount ?? rec["\u6D88\u606F\u6570"] ?? 0) || 0;
  f.sentRatio = Number(rec.sentRatio ?? rec["\u6211\u53D1\u51FA%"] ?? 0) || 0;
  f.userEdited = { role: f.role || void 0, rel: f.rel, alias: f.alias || void 0 };
  return f;
}
function parseJsonBackup(content) {
  let arr;
  try {
    arr = JSON.parse(content);
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];
  return arr.map((r) => applyRecord(r));
}
function parseCsvBackup(content) {
  const lines = content.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 2) return [];
  const headers = lines[0].split(",");
  return lines.slice(1).map((line) => {
    const cells = line.split(",");
    const rec = {};
    headers.forEach((h, i) => {
      rec[h.trim()] = (cells[i] ?? "").trim();
    });
    return applyRecord(rec);
  });
}

// src/stats/stopwords.ts
var STOPWORDS = /* @__PURE__ */ new Set([
  "\u6211\u4EEC",
  "\u4F60\u4EEC",
  "\u4ED6\u4EEC",
  "\u81EA\u5DF1",
  "\u8FD9\u4E2A",
  "\u90A3\u4E2A",
  "\u4EC0\u4E48",
  "\u600E\u4E48",
  "\u53EF\u4EE5",
  "\u6CA1\u6709",
  "\u5C31\u662F",
  "\u8FD9\u6837",
  "\u90A3\u6837",
  "\u4E00\u4E2A",
  "\u73B0\u5728",
  "\u77E5\u9053",
  "\u4E0D\u662F",
  "\u8FD9\u4E48",
  "\u8FD8\u662F",
  "\u5DF2\u7ECF",
  "\u56E0\u4E3A",
  "\u6240\u4EE5",
  "\u4F46\u662F",
  "\u5982\u679C",
  "\u7136\u540E",
  "\u8FD9\u79CD",
  "\u4E00\u4E0B",
  "\u4E00\u4E9B",
  "\u65F6\u5019",
  "\u5E94\u8BE5",
  "\u89C9\u5F97",
  "\u611F\u89C9",
  "\u8FD8\u6709",
  "\u53EF\u80FD",
  "\u5176\u5B9E",
  "\u4E0D\u8FC7",
  "\u53EA\u662F",
  "\u8FD9\u91CC",
  "\u90A3\u91CC",
  "\u4E1C\u897F"
]);

// src/stats/segment.ts
var HAS_CJK = /[一-鿿]/;
var EN_WORD = /^[a-zA-Z]{2,}$/;
var cached = null;
function makeTokenizer() {
  const Seg = globalThis.Intl?.Segmenter;
  if (typeof Seg === "function") {
    try {
      const seg = new Seg("zh", { granularity: "word" });
      return (text) => {
        const out = [];
        for (const s of seg.segment(text)) {
          if (!s.isWordLike) continue;
          const w = s.segment;
          if (w.length < 2) continue;
          if (!HAS_CJK.test(w) && !EN_WORD.test(w)) continue;
          if (STOPWORDS.has(w)) continue;
          out.push(w);
        }
        return out;
      };
    } catch {
    }
  }
  return bigramTokenize;
}
function bigramTokenize(text) {
  const out = [];
  const en = text.match(/[a-zA-Z]{2,}/g) ?? [];
  for (const w of en) if (!STOPWORDS.has(w)) out.push(w);
  const cjk = text.replace(/[^一-鿿]+/g, " ").trim().split(/\s+/).filter(Boolean);
  for (const run of cjk) {
    for (let i = 0; i + 1 < run.length; i++) {
      const w = run.slice(i, i + 2);
      if (STOPWORDS.has(w)) continue;
      out.push(w);
    }
  }
  return out;
}
function tokenize(text) {
  if (!cached) cached = makeTokenizer();
  return cached(text);
}
function countWords(texts, topN) {
  const counts = /* @__PURE__ */ new Map();
  for (const text of texts) {
    for (const w of tokenize(text)) counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, topN).map(([word, count]) => ({ word, count }));
}

// src/stats/emotion.ts
var POS_STRONG = ["\u7231\u4F60", "\u7231", "\u592A\u68D2\u4E86", "\u5E78\u798F", "\u5F00\u5FC3\u6B7B", "\u611F\u52A8", "\u559C\u6B22\u4F60", "\u8D85\u559C\u6B22", "\u4E48\u4E48", "\u62B1\u62B1", "\u60F3\u4F60"];
var POS = ["\u5F00\u5FC3", "\u559C\u6B22", "\u8C22\u8C22", "\u54C8\u54C8", "\u563B\u563B", "\u563F\u563F", "\u68D2", "\u597D\u8036", "\u4E0D\u9519", "\u8D5E", "\u53EF\u7231", "\u751C", "\u6696", "\u8212\u670D", "\u6EE1\u8DB3", "\u671F\u5F85", "\u597D\u7684", "\u597D\u5440", "\u55EF\u55EF", "\u665A\u5B89", "\u8F9B\u82E6\u4E86", "\u52A0\u6CB9", "\u653E\u5FC3"];
var NEG_STRONG = ["\u96BE\u53D7", "\u5D29\u6E83", "\u8BA8\u538C", "\u6EDA", "\u6076\u5FC3", "\u7EDD\u671B", "\u5FC3\u788E", "\u75DB\u82E6", "\u59D4\u5C48", "\u60F3\u54ED", "\u70E6\u6B7B"];
var NEG = ["\u70E6", "\u65E0\u804A", "\u7D2F", "\u5509", "\u545C", "\u751F\u6C14", "\u90C1\u95F7", "\u5931\u671B", "\u96BE\u8FC7", "\u4F24\u5FC3", "emmm", "\u7B97\u4E86", "\u65E0\u8BED", "\u5C34\u5C2C", "\u62C5\u5FC3", "\u5BB3\u6015", "\u5B64\u72EC", "\u522B\u70E6", "\u4E0D\u60F3"];
var LEX = {};
for (const w of POS_STRONG) LEX[w] = 2;
for (const w of POS) LEX[w] = 1;
for (const w of NEG_STRONG) LEX[w] = -2;
for (const w of NEG) LEX[w] = -1;
var EMOJI = {
  "\u{1F604}": 1,
  "\u{1F600}": 1,
  "\u{1F601}": 1,
  "\u{1F970}": 2,
  "\u{1F60D}": 2,
  "\u2764\uFE0F": 2,
  "\u{1F495}": 2,
  "\u{1F602}": 1,
  "\u{1F923}": 1,
  "\u{1F60A}": 1,
  "\u{1F44D}": 1,
  "\u{1F389}": 1,
  "\u{1F618}": 2,
  "\u{1F62D}": -2,
  "\u{1F621}": -2,
  "\u{1F494}": -2,
  "\u{1F614}": -1,
  "\u{1F61E}": -1,
  "\u{1F622}": -1,
  "\u{1F630}": -1,
  "\u{1F629}": -1,
  "\u{1F641}": -1,
  "\u{1F616}": -1
};
var NEG_WORDS = ["\u4E0D", "\u6CA1", "\u522B", "\u65E0", "\u975E", "\u83AB"];
var WORDS_BY_LEN = Object.keys(LEX).sort((a, b) => b.length - a.length);
function wordPolarity(word) {
  const w = LEX[word];
  if (!w) return 0;
  return Math.max(-1, Math.min(1, w / 2));
}
function scoreMessage(text) {
  if (!text) return 0;
  let score = 0;
  const covered = new Array(text.length).fill(false);
  for (const word of WORDS_BY_LEN) {
    let idx = text.indexOf(word);
    while (idx !== -1) {
      const end = idx + word.length;
      let overlap = false;
      for (let i = idx; i < end; i++) {
        if (covered[i]) {
          overlap = true;
          break;
        }
      }
      if (!overlap) {
        const window = text.slice(Math.max(0, idx - 2), idx);
        const negated = NEG_WORDS.some((n) => window.includes(n));
        score += negated ? -LEX[word] : LEX[word];
        for (let i = idx; i < end; i++) covered[i] = true;
      }
      idx = text.indexOf(word, end);
    }
  }
  for (const e in EMOJI) {
    let idx = text.indexOf(e);
    while (idx !== -1) {
      score += EMOJI[e];
      idx = text.indexOf(e, idx + e.length);
    }
  }
  if (/哈哈+|嘻嘻|嘿嘿/.test(text)) score += 1;
  if (/呜呜+|em+/i.test(text)) score -= 1;
  const bangs = (text.match(/[!！]/g) || []).length;
  if (bangs > 0 && score !== 0) {
    score *= Math.min(2, 1 + bangs * 0.2);
  }
  return score;
}
function classify(raw) {
  if (raw > 0.5) return "\u5F00\u5FC3";
  if (raw < -0.5) return "\u96BE\u8FC7";
  return "\u5E73\u6DE1";
}
var R = 3;
function toValue(raw) {
  const clamped = Math.max(-R, Math.min(R, raw));
  return 0.5 + clamped / (2 * R);
}
function emptyAcc() {
  return { happy: 0, neutral: 0, sad: 0, total: 0, valueSum: 0 };
}
function addToAcc(acc, raw) {
  const c = classify(raw);
  if (c === "\u5F00\u5FC3") acc.happy++;
  else if (c === "\u96BE\u8FC7") acc.sad++;
  else acc.neutral++;
  acc.total++;
  acc.valueSum += toValue(raw);
}
function finalizeAcc(acc) {
  return {
    happy: acc.happy,
    neutral: acc.neutral,
    sad: acc.sad,
    total: acc.total,
    avg: acc.total === 0 ? 0.5 : acc.valueSum / acc.total
  };
}
function accToMood(acc) {
  if (acc.total === 0) return null;
  return { avg: acc.valueSum / acc.total, count: acc.total };
}
function mergeDist(a, b) {
  const total = a.total + b.total;
  return {
    happy: a.happy + b.happy,
    neutral: a.neutral + b.neutral,
    sad: a.sad + b.sad,
    total,
    avg: total === 0 ? 0.5 : (a.avg * a.total + b.avg * b.total) / total
  };
}
function mergeMood(a, b) {
  if (!a) return b;
  if (!b) return a;
  const count = a.count + b.count;
  return { avg: (a.avg * a.count + b.avg * b.count) / count, count };
}
function mergeEmotion(a, b, keywords) {
  return {
    me: mergeDist(a.me, b.me),
    them: mergeDist(a.them, b.them),
    monthly: {
      me: a.monthly.me.map((m, i) => mergeMood(m, b.monthly.me[i])),
      them: a.monthly.them.map((m, i) => mergeMood(m, b.monthly.them[i]))
    },
    words: keywords.map((k) => ({ word: k.word, count: k.count, polarity: wordPolarity(k.word) }))
  };
}

// src/stats/aggregate.ts
function peakPeriodLabel(hourly) {
  let peak = -1;
  let peakHour = 0;
  for (let h = 0; h < hourly.length; h++) {
    if (hourly[h] > peak) {
      peak = hourly[h];
      peakHour = h;
    }
  }
  if (peak <= 0) return "";
  if (peakHour < 6) return "\u51CC\u6668";
  if (peakHour < 12) return "\u4E0A\u5348";
  if (peakHour < 14) return "\u4E2D\u5348";
  if (peakHour < 19) return "\u4E0B\u5348";
  return "\u665A\u4E0A";
}
function longestStreak(days) {
  if (days.size === 0) return 0;
  const sorted = [...days].sort((a, b) => a - b);
  let best = 1;
  let run = 1;
  for (let i = 1; i < sorted.length; i++) {
    run = sorted[i] - sorted[i - 1] === 1 ? run + 1 : 1;
    if (run > best) best = run;
  }
  return best;
}
function aggregate(conversations) {
  return conversations.map((c) => {
    const f = createFriend(c.id, c.peerName);
    const msgs = c.messages;
    f.msgCount = msgs.length;
    if (msgs.length === 0) {
      f.emotion = {
        me: finalizeAcc(emptyAcc()),
        them: finalizeAcc(emptyAcc()),
        monthly: { me: Array(12).fill(null), them: Array(12).fill(null) },
        words: []
      };
      return f;
    }
    let sent = 0;
    let first = Infinity;
    let last = -Infinity;
    const texts = [];
    const days = /* @__PURE__ */ new Set();
    const meAcc = emptyAcc();
    const themAcc = emptyAcc();
    const meMonth = Array.from({ length: 12 }, emptyAcc);
    const themMonth = Array.from({ length: 12 }, emptyAcc);
    for (const m of msgs) {
      if (m.from === "me") sent++;
      if (m.ts && m.ts < first) first = m.ts;
      if (m.ts && m.ts > last) last = m.ts;
      if (m.ts) {
        const d = new Date(m.ts);
        f.monthly[d.getMonth()]++;
        f.hourly[d.getHours()]++;
        f.weekHour[d.getDay() * 24 + d.getHours()]++;
        days.add(Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 864e5));
      }
      if (m.type === "text" && m.text) texts.push(m.text);
      const raw = scoreMessage(m.text ?? "");
      const acc = m.from === "me" ? meAcc : themAcc;
      addToAcc(acc, raw);
      if (m.ts) {
        const mo = new Date(m.ts).getMonth();
        addToAcc(m.from === "me" ? meMonth[mo] : themMonth[mo], raw);
      }
    }
    f.keywords = countWords(texts, 20);
    f.sentRatio = Math.round(sent / msgs.length * 100);
    f.firstContact = first === Infinity ? 0 : first;
    f.lastContact = last === -Infinity ? 0 : last;
    f.maxStreak = longestStreak(days);
    f.peakPeriod = peakPeriodLabel(f.hourly);
    f.emotion = {
      me: finalizeAcc(meAcc),
      them: finalizeAcc(themAcc),
      monthly: {
        me: meMonth.map(accToMood),
        them: themMonth.map(accToMood)
      },
      words: f.keywords.map((k) => ({ word: k.word, count: k.count, polarity: wordPolarity(k.word) }))
    };
    return f;
  });
}

// src/stats/global.ts
function sumHourly(friends) {
  const out = new Array(24).fill(0);
  for (const f of friends) {
    const h = f.hourly ?? [];
    for (let i = 0; i < 24; i++) out[i] += h[i] ?? 0;
  }
  return out;
}
function sumWeekHour(friends) {
  const out = new Array(168).fill(0);
  for (const f of friends) {
    const w = f.weekHour ?? [];
    for (let i = 0; i < 168; i++) out[i] += w[i] ?? 0;
  }
  return out;
}
function mergeKeywords(friends, topN) {
  const counts = /* @__PURE__ */ new Map();
  for (const f of friends) {
    for (const k of f.keywords ?? []) counts.set(k.word, (counts.get(k.word) ?? 0) + k.count);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, topN).map(([word, count]) => ({ word, count }));
}

// src/stats/report.ts
function buildReport(conversations, friends, year) {
  const days = /* @__PURE__ */ new Set();
  let total = 0;
  let latest = null;
  conversations.forEach((c) => {
    c.messages.forEach((m) => {
      total++;
      if (m.ts) {
        days.add(new Date(m.ts).toISOString().slice(0, 10));
        if (!latest || m.ts > latest.ts) latest = { ts: m.ts, friendId: c.id };
      }
    });
  });
  const topContacts = [...friends].sort((a, b) => b.msgCount - a.msgCount).slice(0, 3).map((f) => ({ friendId: f.id, msgCount: f.msgCount }));
  const byRel = /* @__PURE__ */ new Map();
  friends.forEach((f) => byRel.set(f.rel, (byRel.get(f.rel) ?? 0) + f.msgCount));
  const relTotal = [...byRel.values()].reduce((a, b) => a + b, 0) || 1;
  const relationBreakdown = [...byRel.entries()].map(([rel, n]) => ({
    rel,
    percent: Math.round(n / relTotal * 100)
  }));
  return {
    year,
    totalMessages: total,
    friendCount: friends.length,
    activeDays: days.size,
    topContacts,
    latestMessage: latest,
    keywords: mergeKeywords(friends, 50),
    relationBreakdown
  };
}

// src/stats/egoGraph.ts
var REL_ORDER = ["\u5BB6\u4EBA", "\u631A\u53CB", "\u540C\u4E8B", "\u540C\u5B66", "\u5BA2\u6237", "\u5176\u4ED6"];
var TWO_PI = Math.PI * 2;
var R_MIN = 0.25;
var R_MAX = 1;
var SIZE_MIN = 0.35;
function buildEgoGraph(friends) {
  if (friends.length === 0) return { nodes: [] };
  const maxMsg = Math.max(...friends.map((f) => f.msgCount), 1);
  const groups = REL_ORDER.map((rel) => ({ rel, members: friends.filter((f) => f.rel === rel) })).filter((g) => g.members.length > 0);
  const weights = groups.map((g) => g.members.length + 1);
  const weightSum = weights.reduce((a, b) => a + b, 0);
  const nodes = [];
  let angleCursor = 0;
  groups.forEach((g, gi) => {
    const span = weights[gi] / weightSum * TWO_PI;
    const ordered = [...g.members].sort((a, b) => b.msgCount - a.msgCount);
    const n = ordered.length;
    ordered.forEach((fr, i) => {
      const angle = angleCursor + span * ((i + 0.5) / n);
      const norm = fr.msgCount / maxMsg;
      nodes.push({
        id: fr.id,
        name: fr.name,
        rel: fr.rel,
        angle,
        radiusFraction: R_MAX - norm * (R_MAX - R_MIN),
        sizeFraction: SIZE_MIN + norm * (1 - SIZE_MIN),
        msgCount: fr.msgCount
      });
    });
    angleCursor += span;
  });
  return { nodes };
}

// src/ai/prompts.ts
function buildReportCopyPrompt(report, friends) {
  const byId = new Map(friends.map((f) => [f.id, f]));
  const top = report.topContacts.map((c, i) => {
    const f = byId.get(c.friendId);
    const name = f ? f.alias || f.name : c.friendId;
    const rel2 = f ? `\xB7${f.rel}` : "";
    const note = f && f.role ? `\uFF0C\u5907\u6CE8\u300C${f.role}\u300D` : "";
    return `${i + 1}. ${name}${rel2}\uFF08${c.msgCount} \u6761${note}\uFF09`;
  }).join("\uFF1B");
  const rel = report.relationBreakdown.map((r) => `${r.rel} ${r.percent}%`).join("\uFF0C");
  return [
    "\u4F60\u662F\u4E00\u4F4D\u6E29\u6696\u7EC6\u817B\u7684\u6587\u6848\u5199\u624B\u3002\u8BF7\u6839\u636E\u4E0B\u9762\u8FD9\u4F4D\u7528\u6237\u7684\u5FAE\u4FE1\u793E\u4EA4\u7EDF\u8BA1\u6570\u636E\uFF0C",
    "\u5199\u4E00\u6BB5 100~200 \u5B57\u3001\u6709\u6E29\u5EA6\u3001\u53E3\u8BED\u5316\u7684\u4E2D\u6587\u5E74\u5EA6\u603B\u7ED3\u6587\u6848\uFF0C\u9002\u5408\u653E\u8FDB\u5E74\u5EA6\u62A5\u544A\u6D77\u62A5\u3002",
    "\u4E0D\u8981\u7F57\u5217\u6570\u5B57\u6E05\u5355\uFF0C\u628A\u6570\u5B57\u81EA\u7136\u878D\u8FDB\u53D9\u8FF0\u91CC\u3002\u53EA\u8F93\u51FA\u6587\u6848\u672C\u8EAB\uFF0C\u4E0D\u8981\u6807\u9898\u3001\u4E0D\u8981\u89E3\u91CA\u3002",
    "\u82E5\u67D0\u4F4D\u8054\u7CFB\u4EBA\u5E26\u6709\u300C\u5907\u6CE8\u300D\uFF0C\u8BF7\u628A\u5B83\u5F53\u4F5C\u4F60\u5BF9\u8FD9\u4E2A\u4EBA\u7684\u4E86\u89E3\uFF0C\u81EA\u7136\u878D\u5165\u5BF9\u4ED6/\u5979\u7684\u63CF\u8FF0\u3002",
    "",
    "\u7EDF\u8BA1\u6570\u636E\uFF1A",
    `- \u5E74\u4EFD\uFF1A${report.year}`,
    `- \u5168\u5E74\u6D88\u606F\u603B\u6570\uFF1A${report.totalMessages}`,
    `- \u8054\u7CFB\u7684\u597D\u53CB\u6570\uFF1A${report.friendCount}`,
    `- \u6D3B\u8DC3\u804A\u5929\u5929\u6570\uFF1A${report.activeDays}`,
    `- \u804A\u5F97\u6700\u591A\u7684\u4EBA\uFF1A${top || "\uFF08\u65E0\uFF09"}`,
    `- \u5173\u7CFB\u5206\u5E03\uFF1A${rel || "\uFF08\u65E0\uFF09"}`
  ].join("\n");
}
var fmtDate = (ts) => ts ? new Date(ts).toISOString().slice(0, 10) : "\u2014";
function buildFriendAnalysisPrompt(friend) {
  const displayName = friend.alias || friend.name;
  const monthly = friend.monthly.map((n, i) => `${i + 1}\u6708 ${n}`).join("\uFF0C");
  return [
    "\u4F60\u662F\u4E00\u4F4D\u6E29\u6696\u7EC6\u817B\u3001\u64C5\u957F\u89C2\u5BDF\u4EBA\u9645\u5173\u7CFB\u7684\u5199\u624B\u3002\u8BF7\u6839\u636E\u4E0B\u9762\u8FD9\u4F4D\u5FAE\u4FE1\u597D\u53CB\u7684\u5F80\u6765\u7EDF\u8BA1\u6570\u636E\uFF0C",
    "\u5199\u4E00\u6BB5 100~200 \u5B57\u3001\u6709\u6E29\u5EA6\u3001\u53E3\u8BED\u5316\u7684\u4E2D\u6587\u300C\u5173\u7CFB\u753B\u50CF\u300D\uFF0C\u9002\u5408\u653E\u8FDB\u4E2A\u4EBA\u5E74\u5EA6\u56DE\u987E\u3002",
    "\u63CF\u8FF0\u4F60\u4EEC\u7684\u5173\u7CFB\u4EB2\u758F\u3001\u4E92\u52A8\u8282\u594F\u3001\u4EE5\u53CA\u503C\u5F97\u8BB0\u4F4F\u7684\u70B9\u3002",
    "\u4E0D\u8981\u7F57\u5217\u6570\u5B57\u6E05\u5355\uFF0C\u628A\u6570\u5B57\u81EA\u7136\u878D\u8FDB\u53D9\u8FF0\u91CC\u3002\u53EA\u8F93\u51FA\u753B\u50CF\u672C\u8EAB\uFF0C\u4E0D\u8981\u6807\u9898\u3001\u4E0D\u8981\u89E3\u91CA\u3002",
    "",
    "\u7EDF\u8BA1\u6570\u636E\uFF08\u5747\u4E3A\u805A\u5408\u7EDF\u8BA1\uFF0C\u4E0D\u542B\u804A\u5929\u5185\u5BB9\uFF09\uFF1A",
    `- \u597D\u53CB\uFF1A${displayName}`,
    `- \u5173\u7CFB\u6807\u7B7E\uFF1A${friend.rel}`,
    `- \u804C\u52A1/\u5907\u6CE8\uFF1A${friend.role || "\uFF08\u672A\u586B\uFF09"}`,
    `- \u5168\u5E74\u6D88\u606F\u5F80\u6765\uFF1A${friend.msgCount} \u6761`,
    `- \u6211\u65B9\u53D1\u9001\u5360\u6BD4\uFF1A${friend.sentRatio}%`,
    `- \u6D3B\u8DC3\u65F6\u6BB5\uFF1A${friend.peakPeriod || "\uFF08\u65E0\uFF09"}`,
    `- \u6700\u957F\u8FDE\u7EED\u804A\u5929\uFF1A${friend.maxStreak} \u5929`,
    `- \u9996\u6B21\u8054\u7CFB\uFF1A${fmtDate(friend.firstContact)}`,
    `- \u6700\u8FD1\u8054\u7CFB\uFF1A${fmtDate(friend.lastContact)}`,
    `- \u5168\u5E74\u6708\u5EA6\u6D88\u606F\u5206\u5E03\uFF1A${monthly}`
  ].join("\n");
}

// src/ai/sentiment.ts
function buildFriendSentimentPrompt(friend, samples) {
  const displayName = friend.alias || friend.name;
  const sampleBlock = samples.length ? samples.map((s, i) => `${i + 1}. ${s}`).join("\n") : "\uFF08\u672C\u6B21\u65E0\u53EF\u7528\u804A\u5929\u6837\u672C\uFF09";
  return [
    "\u4F60\u662F\u4E00\u4F4D\u64C5\u957F\u4F53\u5BDF\u4EBA\u9645\u60C5\u7EEA\u7684\u89C2\u5BDF\u8005\u3002\u8BF7\u6839\u636E\u4E0B\u9762\u8FD9\u4F4D\u5FAE\u4FE1\u597D\u53CB\u7684\u5F80\u6765\u7EDF\u8BA1\u4E0E\u90E8\u5206\u804A\u5929\u6837\u672C\uFF0C",
    "\u5224\u65AD\u4F60\u4EEC\u8FD9\u4E00\u5E74\u76F8\u5904\u7684\u300C\u60C5\u7EEA\u57FA\u8C03\u300D\u3002",
    "",
    "\u53EA\u8F93\u51FA\u4E00\u4E2A\u4E25\u683C\u7684 JSON \u5BF9\u8C61\uFF0C\u4E0D\u8981\u4EFB\u4F55\u89E3\u91CA\u3001\u4E0D\u8981\u4EE3\u7801\u56F4\u680F\u5916\u7684\u6587\u5B57\u3002\u683C\u5F0F\uFF1A",
    '{"tone": "<\u4E00\u4E2A\u5177\u4F53\u3001\u751F\u52A8\u7684\u60C5\u7EEA\u57FA\u8C03\u77ED\u8BCD\uFF0C\u9F13\u52B1\u591A\u6837\uFF0C\u4F8B\u5982 \u70ED\u7EDC / \u66A7\u6627 / \u6E10\u8FDC / \u5BA2\u5957 / \u65E0\u8BDD\u4E0D\u8C08 / \u76F8\u4E92\u6276\u6301 \u7B49>", "summary": "<\u4E00\u53E5\u8BDD\u8BF4\u660E\u4F9D\u636E\uFF0C20~40 \u5B57>"}',
    "",
    "\u805A\u5408\u7EDF\u8BA1\uFF1A",
    `- \u597D\u53CB\uFF1A${displayName}`,
    `- \u5173\u7CFB\u6807\u7B7E\uFF1A${friend.rel}`,
    `- \u804C\u52A1/\u5907\u6CE8\uFF1A${friend.role || "\uFF08\u672A\u586B\uFF09"}`,
    `- \u5168\u5E74\u6D88\u606F\u5F80\u6765\uFF1A${friend.msgCount} \u6761`,
    `- \u6211\u65B9\u53D1\u9001\u5360\u6BD4\uFF1A${friend.sentRatio}%`,
    `- \u6D3B\u8DC3\u65F6\u6BB5\uFF1A${friend.peakPeriod || "\uFF08\u65E0\uFF09"}`,
    "",
    "\u90E8\u5206\u804A\u5929\u6837\u672C\uFF08\u300C\u6211\u300D\u4E3A\u7528\u6237\u672C\u4EBA\uFF0C\u300C\u5BF9\u65B9\u300D\u4E3A\u8BE5\u597D\u53CB\uFF09\uFF1A",
    sampleBlock
  ].join("\n");
}
function buildYearSentimentPrompt(report, sampleLines) {
  const block = sampleLines.length ? sampleLines.map((s, i) => `${i + 1}. ${s}`).join("\n") : "\uFF08\u65E0\u53EF\u7528\u6837\u672C\uFF09";
  return [
    "\u4F60\u662F\u4E00\u4F4D\u6E29\u6696\u7EC6\u817B\u7684\u89C2\u5BDF\u8005\u3002\u8BF7\u6839\u636E\u4E0B\u9762\u8FD9\u4E00\u5E74\u7684\u793E\u4EA4\u7EDF\u8BA1\u4E0E\u82E5\u5E72\u804A\u5929\u6837\u672C\uFF0C",
    "\u5199\u4E00\u6BB5 80~150 \u5B57\u3001\u6709\u6E29\u5EA6\u7684\u4E2D\u6587\uFF0C\u63CF\u8FF0\u8FD9\u4F4D\u7528\u6237\u8FD9\u4E00\u5E74\u6574\u4F53\u7684\u793E\u4EA4\u60C5\u7EEA\u57FA\u8C03",
    "\uFF08\u6BD4\u5982\u70ED\u7EDC\u8FD8\u662F\u6E05\u6DE1\u3001\u4EE5\u6B63\u5411\u8FD8\u662F\u6D88\u8017\u4E3A\u4E3B\u3001\u6709\u54EA\u4E9B\u60C5\u7EEA\u8D77\u4F0F\uFF09\u3002",
    "\u53EA\u8F93\u51FA\u8FD9\u6BB5\u6B63\u6587\uFF0C\u4E0D\u8981\u6807\u9898\u3001\u4E0D\u8981\u89E3\u91CA\u3001\u4E0D\u8981\u7F57\u5217\u6570\u5B57\u3002",
    "",
    "\u5E74\u5EA6\u7EDF\u8BA1\uFF1A",
    `- \u5E74\u4EFD\uFF1A${report.year}`,
    `- \u5168\u5E74\u6D88\u606F\u603B\u6570\uFF1A${report.totalMessages}`,
    `- \u8054\u7CFB\u7684\u597D\u53CB\u6570\uFF1A${report.friendCount}`,
    `- \u6D3B\u8DC3\u804A\u5929\u5929\u6570\uFF1A${report.activeDays}`,
    "",
    "\u8DE8\u597D\u53CB\u804A\u5929\u6837\u672C\uFF08\u8282\u9009\uFF09\uFF1A",
    block
  ].join("\n");
}
function parseSentiment(text) {
  if (typeof text !== "string") return {};
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return {};
  let obj;
  try {
    obj = JSON.parse(text.slice(start, end + 1));
  } catch {
    return {};
  }
  if (typeof obj !== "object" || obj === null) return {};
  const r = obj;
  const out = {};
  if (typeof r.tone === "string" && r.tone.trim() !== "") out.tone = r.tone.trim();
  if (typeof r.summary === "string" && r.summary.trim() !== "") out.summary = r.summary.trim();
  return out;
}
function buildFriendDeepSentimentPrompt(friend, samples) {
  const displayName = friend.alias || friend.name;
  const sampleBlock = samples.length ? samples.map((s, i) => `${i + 1}. ${s}`).join("\n") : "\uFF08\u672C\u6B21\u65E0\u53EF\u7528\u804A\u5929\u6837\u672C\uFF09";
  const monthly = (friend.monthly ?? []).map((c, i) => `${i + 1}\u6708:${c}`).join(" ");
  return [
    "\u4F60\u662F\u4E00\u4F4D\u64C5\u957F\u4F53\u5BDF\u4EBA\u9645\u60C5\u7EEA\u7684\u89C2\u5BDF\u8005\u3002\u8BF7\u6839\u636E\u4E0B\u9762\u8FD9\u4F4D\u5FAE\u4FE1\u597D\u53CB\u7684\u5F80\u6765\u7EDF\u8BA1\u4E0E\u90E8\u5206\u804A\u5929\u6837\u672C\uFF0C",
    "\u5224\u65AD\u4F60\u4EEC\u8FD9\u4E00\u5E74\u76F8\u5904\u7684\u300C\u60C5\u7EEA\u57FA\u8C03\u300D\uFF0C\u5E76\u7ED9\u51FA\u9010\u6708\u60C5\u7EEA\u8D70\u52BF\uFF0C\u4EE5\u53CA\u53CC\u65B9\u5404\u81EA\u7684\u60C5\u7EEA\u3002",
    "",
    "\u53EA\u8F93\u51FA\u4E00\u4E2A\u4E25\u683C\u7684 JSON \u5BF9\u8C61\uFF0C\u4E0D\u8981\u4EFB\u4F55\u89E3\u91CA\u3001\u4E0D\u8981\u4EE3\u7801\u56F4\u680F\u5916\u7684\u6587\u5B57\u3002\u683C\u5F0F\uFF1A",
    "{",
    '  "tone": "<\u4E00\u4E2A\u5177\u4F53\u3001\u751F\u52A8\u7684\u60C5\u7EEA\u57FA\u8C03\u77ED\u8BCD\uFF0C\u5982 \u70ED\u7EDC/\u66A7\u6627/\u6E10\u8FDC/\u5BA2\u5957/\u65E0\u8BDD\u4E0D\u8C08>",',
    '  "summary": "<\u4E00\u53E5\u8BDD\u8BF4\u660E\u4F9D\u636E\uFF0C20~40 \u5B57>",',
    '  "timeline": [<\u8986\u76D6 1~12 \u6708\uFF0C\u6BCF\u9879\u5F62\u5982>{"m": <\u6708\u4EFD1-12>, "score": <\u8BE5\u6708\u60C5\u7EEA\u5206\u503C\uFF0C-100 \u6700\u6D88\u6781 ~ 100 \u6700\u79EF\u6781\uFF1B\u8BE5\u6708\u65E0\u5F80\u6765\u5219\u4E3A null>}],',
    '  "me": {"tone": "<\u6211\u65B9\u60C5\u7EEA\u57FA\u8C03\u77ED\u8BCD>", "summary": "<\u4E00\u53E5\u8BDD\uFF0C20~40 \u5B57>"},',
    '  "them": {"tone": "<\u5BF9\u65B9\u60C5\u7EEA\u57FA\u8C03\u77ED\u8BCD>", "summary": "<\u4E00\u53E5\u8BDD\uFF0C20~40 \u5B57>"}',
    "}",
    "",
    "\u805A\u5408\u7EDF\u8BA1\uFF1A",
    `- \u597D\u53CB\uFF1A${displayName}`,
    `- \u5173\u7CFB\u6807\u7B7E\uFF1A${friend.rel}`,
    `- \u804C\u52A1/\u5907\u6CE8\uFF1A${friend.role || "\uFF08\u672A\u586B\uFF09"}`,
    `- \u5168\u5E74\u6D88\u606F\u5F80\u6765\uFF1A${friend.msgCount} \u6761`,
    `- \u6211\u65B9\u53D1\u9001\u5360\u6BD4\uFF1A${friend.sentRatio}%`,
    `- \u6D3B\u8DC3\u65F6\u6BB5\uFF1A${friend.peakPeriod || "\uFF08\u65E0\uFF09"}`,
    `- \u9010\u6708\u6D88\u606F\u6570\uFF1A${monthly}`,
    "",
    "\uFF08timeline \u5FC5\u987B\u9010\u6708\u7ED9\u51FA\uFF1A\u67D0\u6708\u9010\u6708\u6D88\u606F\u6570\u4E3A 0 \u65F6\u8BE5\u6708 score \u7528 null\uFF0C\u4E0D\u8981\u7F16\u9020\u60C5\u7EEA\u3002\uFF09",
    "",
    "\u90E8\u5206\u804A\u5929\u6837\u672C\uFF08\u300C\u6211\u300D\u4E3A\u7528\u6237\u672C\u4EBA\uFF0C\u300C\u5BF9\u65B9\u300D\u4E3A\u8BE5\u597D\u53CB\uFF09\uFF1A",
    sampleBlock
  ].join("\n");
}

// src/ai/profile.ts
function buildFriendProfilePrompt(friend, samples) {
  const displayName = friend.alias || friend.name;
  const sampleBlock = samples.length ? samples.map((s, i) => `${i + 1}. ${s}`).join("\n") : "\uFF08\u672C\u6B21\u65E0\u53EF\u7528\u804A\u5929\u6837\u672C\uFF09";
  return [
    "\u4F60\u662F\u4E00\u4F4D\u64C5\u957F\u4ECE\u804A\u5929\u8BB0\u5F55\u63A8\u65AD\u4EBA\u7269\u80CC\u666F\u7684\u89C2\u5BDF\u8005\u3002\u8BF7\u6839\u636E\u4E0B\u9762\u8FD9\u4F4D\u5FAE\u4FE1\u597D\u53CB\u7684\u5F80\u6765\u7EDF\u8BA1\u4E0E\u90E8\u5206\u804A\u5929\u6837\u672C\uFF0C",
    "\u63A8\u65AD TA \u7684\u591A\u65B9\u9762\u753B\u50CF\uFF0C\u4F9B\u91D1\u878D\u4ECE\u4E1A\u8005\u4E86\u89E3\u5BA2\u6237\u4E4B\u7528\u3002",
    "",
    "\u53EA\u8F93\u51FA\u4E00\u4E2A\u4E25\u683C\u7684 JSON \u5BF9\u8C61\uFF0C\u4E0D\u8981\u4EFB\u4F55\u89E3\u91CA\u3001\u4E0D\u8981\u4EE3\u7801\u56F4\u680F\u5916\u7684\u6587\u5B57\u3002\u683C\u5F0F\uFF1A",
    "{",
    '  "identity": "<\u8EAB\u4EFD/\u804C\u4E1A\uFF1A\u884C\u4E1A+\u5934\u8854+\u5355\u4F4D\u7C7B\u578B\uFF0C\u4E00\u5C0F\u6BB5\u7B80\u8FF0>",',
    '  "family": "<\u5BB6\u5EAD\u72B6\u51B5\uFF1A\u5A5A\u5426\u3001\u5B50\u5973\u3001\u4E0E\u5BB6\u4EBA\u4E92\u52A8\uFF0C\u4E00\u5C0F\u6BB5\u7B80\u8FF0>",',
    '  "romance": "<\u611F\u60C5\u72B6\u6001\uFF1A\u5355\u8EAB/\u604B\u7231/\u5DF2\u5A5A\u7B49\uFF0C\u4E00\u5C0F\u6BB5\u7B80\u8FF0>",',
    '  "lifestyle": "<\u751F\u6D3B\u65B9\u5F0F\uFF1A\u5174\u8DA3\u7231\u597D\u3001\u4F5C\u606F\u3001\u5E38\u804A\u8BDD\u9898\uFF0C\u4E00\u5C0F\u6BB5\u7B80\u8FF0>",',
    '  "investment": {',
    '    "summary": "<\u6295\u8D44\u504F\u597D\u603B\u8FF0\uFF0C\u4E00\u5C0F\u6BB5>",',
    '    "risk": "<\u98CE\u9669\u504F\u597D\uFF1A\u4FDD\u5B88/\u7A33\u5065/\u5E73\u8861/\u8FDB\u53D6\uFF0C\u9644\u4F9D\u636E>",',
    '    "categories": "<\u5173\u6CE8\u54C1\u7C7B\uFF1A\u80A1\u7968/\u57FA\u91D1/\u623F\u4EA7/\u4FDD\u9669/\u9EC4\u91D1/\u5B58\u6B3E/\u52A0\u5BC6\u7B49>",',
    '    "wealth": "<\u8D22\u5BCC\u4E0E\u53EF\u6295\u7EBF\u7D22\uFF1A\u5927\u81F4\u8D22\u5BCC\u6C34\u5E73\u3001\u662F\u5426\u6709\u95F2\u7F6E\u8D44\u91D1>",',
    '    "style": "<\u51B3\u7B56\u98CE\u683C\u4E0E\u5468\u671F\uFF1A\u81EA\u4E3B/\u542C\u5EFA\u8BAE\u3001\u957F\u7EBF/\u77ED\u7EBF/\u6295\u673A\u3001\u5F53\u4E0B\u662F\u5426\u6709\u7406\u8D22\u9700\u6C42>"',
    "  }",
    "}",
    "",
    "\u8981\u6C42\uFF1A\u6BCF\u4E2A\u5B57\u6BB5\u7ED9\u4E00\u5C0F\u6BB5\u7B80\u8FF0\uFF08\u7EA6 30~60 \u5B57\uFF0C\u53EF\u70B9\u51FA\u804A\u5929\u91CC\u7684\u4F9D\u636E\uFF09\uFF0C\u4E0D\u8981\u53EA\u7ED9\u4E00\u4E2A\u6807\u7B7E\u8BCD\u3002",
    "\u4EFB\u4E00\u5B57\u6BB5\u82E5\u6837\u672C\u4E2D\u65E0\u53EF\u9760\u7EBF\u7D22\uFF0C\u503C\u586B\u300C\u6682\u65E0\u8DB3\u591F\u7EBF\u7D22\u300D\uFF0C\u7981\u6B62\u81C6\u6D4B\uFF08\u5C24\u5176\u611F\u60C5\u3001\u5BB6\u5EAD\u3001\u8D22\u5BCC\uFF09\u3002",
    "",
    "\u805A\u5408\u7EDF\u8BA1\uFF1A",
    `- \u597D\u53CB\uFF1A${displayName}`,
    `- \u5173\u7CFB\u6807\u7B7E\uFF1A${friend.rel}`,
    `- \u804C\u52A1/\u5907\u6CE8\uFF1A${friend.role || "\uFF08\u672A\u586B\uFF09"}`,
    `- \u5168\u5E74\u6D88\u606F\u5F80\u6765\uFF1A${friend.msgCount} \u6761`,
    `- \u6211\u65B9\u53D1\u9001\u5360\u6BD4\uFF1A${friend.sentRatio}%`,
    `- \u6D3B\u8DC3\u65F6\u6BB5\uFF1A${friend.peakPeriod || "\uFF08\u65E0\uFF09"}`,
    "",
    "\u90E8\u5206\u804A\u5929\u6837\u672C\uFF08\u300C\u6211\u300D\u4E3A\u7528\u6237\u672C\u4EBA\uFF0C\u300C\u5BF9\u65B9\u300D\u4E3A\u8BE5\u597D\u53CB\uFF09\uFF1A",
    sampleBlock
  ].join("\n");
}
function pickText(v) {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : void 0;
}
function pickInvestment(v) {
  if (typeof v !== "object" || v === null) return void 0;
  const r = v;
  const out = {};
  const summary = pickText(r.summary);
  if (summary) out.summary = summary;
  const risk = pickText(r.risk);
  if (risk) out.risk = risk;
  const categories = pickText(r.categories);
  if (categories) out.categories = categories;
  const wealth = pickText(r.wealth);
  if (wealth) out.wealth = wealth;
  const style = pickText(r.style);
  if (style) out.style = style;
  return Object.keys(out).length ? out : void 0;
}
function parseFriendProfile(text) {
  if (typeof text !== "string") return {};
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return {};
  let obj;
  try {
    obj = JSON.parse(text.slice(start, end + 1));
  } catch {
    return {};
  }
  if (typeof obj !== "object" || obj === null) return {};
  const r = obj;
  const out = {};
  const identity = pickText(r.identity);
  if (identity) out.identity = identity;
  const family = pickText(r.family);
  if (family) out.family = family;
  const romance = pickText(r.romance);
  if (romance) out.romance = romance;
  const lifestyle = pickText(r.lifestyle);
  if (lifestyle) out.lifestyle = lifestyle;
  const investment = pickInvestment(r.investment);
  if (investment) out.investment = investment;
  return out;
}

// src/ai/suggestion.ts
var RELATIONS2 = ["\u5BB6\u4EBA", "\u631A\u53CB", "\u540C\u4E8B", "\u540C\u5B66", "\u5BA2\u6237", "\u5176\u4ED6"];
function extractFriendSamples(conversations, opts = {}) {
  const maxPerFriend = opts.maxPerFriend ?? 30;
  const maxChars = opts.maxChars ?? 80;
  const out = {};
  for (const conv of conversations) {
    const texts = conv.messages.filter((m) => m.type === "text" && typeof m.text === "string" && m.text.trim() !== "").slice().sort((a, b) => a.ts - b.ts);
    const picked = sampleEvenly(texts, maxPerFriend);
    out[conv.id] = picked.map((m) => {
      const who = m.from === "me" ? "\u6211" : "\u5BF9\u65B9";
      const body = (m.text ?? "").trim().slice(0, maxChars);
      return `${who}\uFF1A${body}`;
    });
  }
  return out;
}
function sampleEvenly(items, max) {
  if (items.length <= max) return items;
  const result = [];
  for (let i = 0; i < max; i++) {
    const idx = Math.floor(i * items.length / max);
    result.push(items[idx]);
  }
  return result;
}
function buildFriendSuggestionPrompt(friend, samples) {
  const displayName = friend.alias || friend.name;
  const sampleBlock = samples.length ? samples.map((s, i) => `${i + 1}. ${s}`).join("\n") : "\uFF08\u672C\u6B21\u65E0\u53EF\u7528\u804A\u5929\u6837\u672C\uFF09";
  return [
    "\u4F60\u662F\u4E00\u4F4D\u64C5\u957F\u4ECE\u804A\u5929\u8BB0\u5F55\u4E2D\u5224\u65AD\u4EBA\u9645\u5173\u7CFB\u7684\u52A9\u624B\u3002",
    "\u8BF7\u6839\u636E\u4E0B\u9762\u8FD9\u4F4D\u5FAE\u4FE1\u597D\u53CB\u7684\u805A\u5408\u7EDF\u8BA1\u4E0E\u90E8\u5206\u804A\u5929\u5185\u5BB9\u6837\u672C\uFF0C\u63A8\u65AD\u4F60\u4EEC\u7684\u300C\u5173\u7CFB\u300D\u4E0E\u5BF9\u65B9\u7684\u300C\u804C\u52A1/\u8EAB\u4EFD\u300D\u3002",
    "",
    `\u53EA\u8F93\u51FA\u4E00\u4E2A\u4E25\u683C\u7684 JSON \u5BF9\u8C61\uFF0C\u4E0D\u8981\u4EFB\u4F55\u89E3\u91CA\u3001\u4E0D\u8981\u4EE3\u7801\u56F4\u680F\u5916\u7684\u6587\u5B57\u3002\u683C\u5F0F\uFF1A`,
    `{"rel": "<\u4E0B\u5217\u4E4B\u4E00\uFF1A${RELATIONS2.join(" | ")}>", "role": "<\u804C\u52A1\u6216\u8EAB\u4EFD\u6807\u7B7E\uFF0C\u7B80\u77ED\uFF0C\u65E0\u6CD5\u5224\u65AD\u5219\u7A7A\u5B57\u7B26\u4E32>", "reason": "<\u4E00\u53E5\u8BDD\u4F9D\u636E>"}`,
    "",
    "\u805A\u5408\u7EDF\u8BA1\uFF1A",
    `- \u597D\u53CB\uFF1A${displayName}`,
    `- \u5F53\u524D\u5173\u7CFB\u6807\u7B7E\uFF1A${friend.rel}`,
    `- \u5F53\u524D\u804C\u52A1/\u5907\u6CE8\uFF1A${friend.role || "\uFF08\u672A\u586B\uFF09"}`,
    `- \u5168\u5E74\u6D88\u606F\u5F80\u6765\uFF1A${friend.msgCount} \u6761`,
    `- \u6211\u65B9\u53D1\u9001\u5360\u6BD4\uFF1A${friend.sentRatio}%`,
    `- \u6D3B\u8DC3\u65F6\u6BB5\uFF1A${friend.peakPeriod || "\uFF08\u65E0\uFF09"}`,
    `- \u6700\u957F\u8FDE\u7EED\u804A\u5929\uFF1A${friend.maxStreak} \u5929`,
    "",
    "\u90E8\u5206\u804A\u5929\u5185\u5BB9\u6837\u672C\uFF08\u4EC5\u4E3A\u7247\u6BB5\uFF0C\u300C\u6211\u300D\u4E3A\u7528\u6237\u672C\u4EBA\uFF0C\u300C\u5BF9\u65B9\u300D\u4E3A\u8BE5\u597D\u53CB\uFF09\uFF1A",
    sampleBlock
  ].join("\n");
}
function isRelation(v) {
  return typeof v === "string" && RELATIONS2.includes(v);
}
function parseFriendSuggestion(text) {
  if (typeof text !== "string") return {};
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return {};
  let obj;
  try {
    obj = JSON.parse(text.slice(start, end + 1));
  } catch {
    return {};
  }
  if (typeof obj !== "object" || obj === null) return {};
  const record = obj;
  const result = {};
  if (isRelation(record.rel)) result.rel = record.rel;
  if (typeof record.role === "string" && record.role.trim() !== "") result.role = record.role.trim();
  if (typeof record.reason === "string" && record.reason.trim() !== "") {
    result.reason = record.reason.trim();
  }
  return result;
}

// src/merge/merge.ts
var msgKey = (m) => `${m.ts}|${m.from}|${m.text ?? ""}`;
function mergeConversations(a, b) {
  const byPeer = /* @__PURE__ */ new Map();
  const add = (c) => {
    const exist = byPeer.get(c.peerName);
    if (!exist) {
      byPeer.set(c.peerName, { ...c, messages: [...c.messages] });
    } else {
      exist.messages.push(...c.messages);
    }
  };
  [...a, ...b].forEach(add);
  return [...byPeer.values()].map((c) => {
    const seen = /* @__PURE__ */ new Set();
    const messages = c.messages.filter((m) => {
      const k = msgKey(m);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    }).sort((x, y) => x.ts - y.ts);
    return { ...c, messages };
  });
}
function mergeFriends(existing, incoming) {
  const byId = /* @__PURE__ */ new Map();
  existing.forEach((f) => byId.set(f.id, f));
  let added = 0;
  let updated = 0;
  incoming.forEach((inc) => {
    const old = byId.get(inc.id);
    if (!old) {
      byId.set(inc.id, inc);
      added++;
      return;
    }
    updated++;
    const merged = { ...inc };
    merged.role = old.userEdited.role ?? inc.role;
    merged.rel = old.userEdited.rel ?? inc.rel;
    merged.alias = old.userEdited.alias ?? inc.alias;
    merged.name = old.userEdited.name ?? inc.name;
    merged.userEdited = { ...inc.userEdited, ...old.userEdited };
    if (old.emotion && inc.emotion) {
      merged.emotion = mergeEmotion(old.emotion, inc.emotion, merged.keywords);
    } else {
      merged.emotion = inc.emotion ?? old.emotion;
    }
    byId.set(inc.id, merged);
  });
  return { friends: [...byId.values()], added, updated };
}
function applyContactNames(friends, names) {
  const byId = new Map(names.map((n) => [n.id, n.name]));
  return friends.map((f) => {
    const name = byId.get(f.id);
    if (!name) return f;
    return { ...f, name, userEdited: { ...f.userEdited, name } };
  });
}

// src/parsers/welive-contacts.ts
function isWeliveContacts(sample) {
  const s = sample.replace(/^﻿/, "").trimStart();
  if (!s.startsWith("[")) return false;
  if (!s.includes('"username"')) return false;
  if (!s.includes('"nick_name"') && !s.includes('"remark"')) return false;
  return s.includes('"local_type"');
}
function parseWeliveContacts(content) {
  let raw;
  try {
    raw = JSON.parse(content.replace(/^﻿/, ""));
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item;
    const id = String(r.username ?? "").trim();
    if (!id) continue;
    const name = String(r.remark ?? "").trim() || String(r.nick_name ?? "").trim();
    if (!name) continue;
    out.push({ id, name });
  }
  return out;
}

// src/index.ts
var version = "0.1.0";
export {
  aggregate,
  applyContactNames,
  buildEgoGraph,
  buildFriendAnalysisPrompt,
  buildFriendDeepSentimentPrompt,
  buildFriendProfilePrompt,
  buildFriendSentimentPrompt,
  buildFriendSuggestionPrompt,
  buildReport,
  buildReportCopyPrompt,
  buildYearSentimentPrompt,
  classify,
  countWords,
  createFriend,
  extractFriendSamples,
  isServiceSession,
  isWeliveContacts,
  mergeConversations,
  mergeFriends,
  mergeKeywords,
  parseCsvBackup,
  parseFile,
  parseFriendProfile,
  parseFriendSuggestion,
  parseJsonBackup,
  parseSentiment,
  parseWeliveContacts,
  scoreMessage,
  sessionIdFromFileName,
  sumHourly,
  sumWeekHour,
  toValue,
  tokenize,
  version,
  wordPolarity
};
