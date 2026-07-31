const GOOGLE_TAG_ID = process.env.GOOGLE_TAG_ID || "";

export function googleAnalyticsHead(): string {
  if (!GOOGLE_TAG_ID) return "";
  return `<script async src="https://www.googletagmanager.com/gtag/js?id=${GOOGLE_TAG_ID}"></script>
<script>
window.dataLayer=window.dataLayer||[];
function gtag(){dataLayer.push(arguments);}
gtag('js',new Date());
gtag('config','${GOOGLE_TAG_ID}');
</script>`;
}

export const ANALYTICS_CSP = {
  scriptSrc: "https://www.googletagmanager.com",
  connectSrc:
    "https://www.google-analytics.com https://*.google-analytics.com https://stats.g.doubleclick.net",
  imgSrc: "https://www.google-analytics.com https://stats.g.doubleclick.net",
};
