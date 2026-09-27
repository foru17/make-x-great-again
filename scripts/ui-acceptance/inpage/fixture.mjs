// Simulated X pages (DOM shape the content script keys on) for in-page UI
// acceptance. Served by route-fulfilling https://x.com/* so the real built
// extension injects exactly as on production.
const THEMES = {
  light: { bg: "rgb(255, 255, 255)", fg: "rgb(15, 20, 25)", muted: "rgb(83, 100, 113)", border: "rgb(239, 243, 244)", hover: "rgb(247, 249, 249)" },
  dim: { bg: "rgb(21, 32, 43)", fg: "rgb(247, 249, 249)", muted: "rgb(139, 152, 165)", border: "rgb(56, 68, 77)", hover: "rgb(28, 39, 50)" },
  lightsout: { bg: "rgb(0, 0, 0)", fg: "rgb(231, 233, 234)", muted: "rgb(113, 118, 123)", border: "rgb(47, 51, 54)", hover: "rgb(8, 8, 8)" },
};

export const AVATAR = "https://pbs.twimg.com/profile_images/1/av_normal.jpg";

const AUTHORS = {
  spam_confirmed: { name: "小可爱 🍑", bio: "24h 在线 看主页" },
  spam_auto: { name: "Daily Deals", bio: "" },
  rulehit_bot: { name: "Gigi 🌸", bio: "" },
  local_wl_user: { name: "老朋友", bio: "关注了很久的账号" },
  ghost_user: { name: "Someone Normal", bio: "just here" },
  cached_spam: { name: "资源分享", bio: "全网资源" },
  someone: { name: "Tech Reporter", bio: "news" },
  me_viewer: { name: "Me", bio: "" },
};

function esc(s) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

function article({ handle, text, id, replyTo, t }) {
  const a = AUTHORS[handle] ?? { name: handle };
  return `
  <article data-testid="tweet" tabindex="0" style="display:flex;gap:12px;padding:12px 16px;border-bottom:1px solid ${t.border}">
    <div data-testid="Tweet-User-Avatar" style="flex:none"><img src="${AVATAR}" width="40" height="40" style="border-radius:50%;display:block;background:${t.border}" alt=""></div>
    <div style="min-width:0;flex:1">
      <div data-testid="User-Name" style="display:flex;align-items:center;gap:4px;flex-wrap:wrap;font-size:15px;line-height:20px">
        <a href="/${handle}" style="color:${t.fg};font-weight:700;text-decoration:none">${esc(a.name)}</a>
        <span style="color:${t.muted}">@${handle}</span>
        <span style="color:${t.muted}">·</span>
        <a href="/${handle}/status/${id}" style="color:${t.muted};text-decoration:none"><time datetime="2026-09-06T10:00:00Z">2h</time></a>
      </div>
      ${replyTo ? `<div dir="ltr" style="color:${t.muted};font-size:15px;line-height:20px"><span>Replying to </span><a href="/${replyTo}" style="color:rgb(29,155,240);text-decoration:none">@${replyTo}</a></div>` : ""}
      <div data-testid="tweetText" lang="zh" style="color:${t.fg};font-size:15px;line-height:20px;margin-top:2px;white-space:pre-wrap">${esc(text)}</div>
      <div style="display:flex;gap:48px;margin-top:12px;color:${t.muted};font-size:13px"><span>💬 3</span><span>🔁 1</span><span>♥ 12</span><span>👁 1.2K</span></div>
    </div>
  </article>`;
}

const FEED = [
  { handle: "someone", text: "苹果发布会汇总：新 iPhone 的三个变化", id: 100 },
  { handle: "spam_confirmed", text: "看主页 @dispatcher01", id: 101 },
  { handle: "spam_auto", text: "Best VPN deal of the year 👉 vpndeal.example/aff", id: 102 },
  { handle: "rulehit_bot", text: "刷了半天的X 就她的主页能打✈️了 @lyclne 1k", id: 103 },
  { handle: "local_wl_user", text: "今天天气不错，出去走走", id: 104, replyTo: "someone" },
  { handle: "ghost_user", text: "这个总结很到位，感谢", id: 105, replyTo: "someone" },
  { handle: "cached_spam", text: "完整版资源已整理好 夸克网盘 链接见主页", id: 106 },
];

export function page({ path, theme = "lightsout", mobile = false }) {
  const t = THEMES[theme];
  const width = mobile ? "100%" : "600px";
  let body = "";
  let title = "Home / X";
  const m = path.match(/^\/([A-Za-z0-9_]+)\/status\/(\d+)/);
  if (path === "/home") {
    body = FEED.map((f) => article({ ...f, t })).join("");
  } else if (m) {
    title = "Post / X";
    const focal = FEED[0];
    body =
      article({ ...focal, t }) +
      FEED.slice(1)
        .map((f) => article({ ...f, replyTo: undefined, t }))
        .join("");
  } else {
    const handle = path.replace(/^\//, "").split("/")[0];
    const a = AUTHORS[handle] ?? { name: handle, bio: "" };
    title = `${a.name} (@${handle}) / X`;
    body = `
    <div style="height:120px;background:${t.border}"></div>
    <div style="padding:12px 16px;border-bottom:1px solid ${t.border}">
      <div style="display:flex;justify-content:space-between;align-items:flex-end">
        <img src="${AVATAR}" width="96" height="96" style="border-radius:50%;margin-top:-60px;border:4px solid ${t.bg};background:${t.border}" alt="">
        <button data-testid="1003-${handle === "local_wl_user" ? "unfollow" : "follow"}" style="border:1px solid ${t.muted};background:transparent;color:${t.fg};border-radius:999px;padding:6px 16px;font-weight:700">${handle === "local_wl_user" ? "Following" : "Follow"}</button>
      </div>
      <div data-testid="UserName" style="margin-top:8px;display:flex;flex-direction:column;font-size:20px;line-height:24px;font-weight:800;color:${t.fg}"><span>${esc(a.name)}</span><span style="font-size:15px;font-weight:400;color:${t.muted}">@${handle}</span></div>
      <div data-testid="UserDescription" style="margin-top:12px;color:${t.fg};font-size:15px">${esc(a.bio ?? "")}</div>
      <div data-testid="UserJoinDate" style="margin-top:12px;color:${t.muted};font-size:15px">📅 Joined March 2024</div>
      <div style="margin-top:12px;display:flex;gap:20px;font-size:14px"><a href="/${handle}/following" style="color:${t.fg};text-decoration:none"><b>3,100</b> <span style="color:${t.muted}">Following</span></a><a href="/${handle}/verified_followers" style="color:${t.fg};text-decoration:none"><b>12</b> <span style="color:${t.muted}">Followers</span></a></div>
    </div>` +
      FEED.filter((f) => f.handle === handle || f.handle === "someone")
        .map((f) => article({ ...f, handle, replyTo: undefined, t }))
        .join("");
  }
  return `<!doctype html><html lang="en" style="color-scheme:${theme === "light" ? "light" : "dark"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
  <style>html,body{margin:0}body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:${t.fg}} a:hover{text-decoration:underline}</style></head>
  <body style="background-color: ${t.bg};">
    <div style="display:flex;justify-content:center;min-height:100vh">
      ${mobile ? "" : `<header style="width:275px;padding:8px 12px;position:sticky;top:0;height:100vh;box-sizing:border-box">
        <div style="font-size:26px;padding:8px">𝕏</div>
        <nav style="display:flex;flex-direction:column;gap:6px;font-size:20px">
          <a href="/home" style="color:${t.fg};text-decoration:none;padding:12px">🏠 Home</a>
          <a href="/explore" style="color:${t.fg};text-decoration:none;padding:12px">🔍 Explore</a>
          <a href="/notifications" style="color:${t.fg};text-decoration:none;padding:12px">🔔 Notifications</a>
          <a data-testid="AppTabBar_Profile_Link" href="/me_viewer" style="color:${t.fg};text-decoration:none;padding:12px">👤 Profile</a>
        </nav></header>`}
      <main role="main" style="width:${width};max-width:100%;border-left:1px solid ${t.border};border-right:1px solid ${t.border};min-height:100vh">
        <div data-testid="primaryColumn">
          <div style="position:sticky;top:0;backdrop-filter:blur(12px);background:color-mix(in srgb, ${t.bg} 85%, transparent);padding:12px 16px;font-weight:800;font-size:20px;border-bottom:1px solid ${t.border}">${path === "/home" ? "Home" : m ? "Post" : "Profile"}</div>
          ${body}
        </div>
      </main>
      ${mobile ? "" : `<aside style="width:350px;padding:12px 24px"><div style="border:1px solid ${t.border};border-radius:16px;padding:12px;color:${t.muted}">What's happening</div></aside>`}
    </div>
  </body></html>`;
}
