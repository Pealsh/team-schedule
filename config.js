// Firebase の projectId と Web API key。公開しても安全な値（読み書きはルールで制限）。
// チームキーはここに書かない（画面で入力 or 共有リンク #k=... で渡す）。
export const FIREBASE_PROJECT_ID = 'team-schedule-5afa8a';
export const FIREBASE_API_KEY = 'AIzaSyCkorbvyVXo3nrS-1DUGPs2ewACRN5pC0Q';
// MCP / REST を提供する Cloudflare Worker の URL（worker/ を deploy すると決まる）
export const WORKER_URL = 'https://team-schedule.pengutobitai.workers.dev';
