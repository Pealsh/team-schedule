// Worker は常に UTC で動くので、「UTC の 0:00 = 指定地域の 0:00」とみなすずらしを api に掛ける。
// tools / timeline はローカル時刻のメソッドを使うため、こうすると日本時間で計算される（夏時間のない地域向け）。

export function withFixedOffset(api, offsetMin) {
  const ms = offsetMin * 60000;
  const shift = (t, d) => new Date(new Date(t).getTime() + d).toISOString();
  const out = (e) => ({ ...e, starts_at: shift(e.starts_at, ms), ends_at: shift(e.ends_at, ms) });
  return {
    ...api,
    async events(from, to) {
      const list = await api.events(new Date(from.getTime() - ms), new Date(to.getTime() - ms));
      return list.map(out);
    },
    async addEvent(e) {
      return out(await api.addEvent({ ...e, starts_at: shift(e.starts_at, -ms), ends_at: shift(e.ends_at, -ms) }));
    },
  };
}

export const fixedNow = (offsetMin) => () => new Date(Date.now() + offsetMin * 60000);
