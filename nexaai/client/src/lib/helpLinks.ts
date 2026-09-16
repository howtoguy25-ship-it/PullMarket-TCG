// Real, in-app navigation targets for follow-up guidance — not every reply
// gets a link, only ones whose QUESTION clearly names a specific settings/
// usage screen the user would actually want next (e.g. asking about billing
// surfaces a real link to Credits). Deliberately matched against what the
// user asked, never against NexaAi's own reply text: a reply can casually
// mention "capabilities" or "connectors" in passing on any topic, which
// would false-positive a link that has nothing to do with the question.
export interface HelpLink {
  label: string;
  screen: string;
  params?: Record<string, unknown>;
}

interface HelpLinkRule {
  keywords: RegExp;
  link: HelpLink;
}

const RULES: HelpLinkRule[] = [
  {
    keywords: /\b(connectors?|integrations?|connect (my |a )?(slack|notion|google|github|vercel|netlify|stripe)|oauth|webhook|mcp server)\b/i,
    link: { label: "Open Connectors", screen: "Connectors" },
  },
  {
    keywords: /\b(permissions?|camera access|microphone access|mic access|toggle (a |my )?capabilit(y|ies))\b/i,
    link: { label: "Review Capabilities", screen: "Capabilities" },
  },
  {
    keywords: /\b(memory files?|what do you remember|forget (this|that|me)|delete (my )?memory)\b/i,
    link: { label: "Manage Memory", screen: "MemoryFiles" },
  },
  {
    keywords: /\b(chat history|past chats?|old chats?|previous conversation|recent chats?)\b/i,
    link: { label: "View History", screen: "History" },
  },
  {
    keywords: /\b(subscri(be|ption)|upgrade (my |to a )?plan|nexa pro|zenith plan|nova plan|which plan|change (my )?plan)\b/i,
    link: { label: "See Plans", screen: "Plans" },
  },
  {
    keywords: /\b(billing|credits?|my usage|recharge|reload|balance|top ?up|how much (did|does|will)|cost of|refund|dispute)\b/i,
    link: { label: "View Credits & Usage", screen: "Credits" },
  },
  {
    keywords: /\b(my projects?|build (a|my|an) (app|website|site)|sitespark)\b/i,
    link: { label: "Open Projects", screen: "Projects" },
  },
  {
    keywords: /\b(my agents?|autoresponder|agent builder)\b/i,
    link: { label: "Open My Agents", screen: "Agents" },
  },
  {
    keywords: /\b(theme|appearance|dark mode|light mode|change (the )?font|colou?r scheme)\b/i,
    link: { label: "Open Appearance", screen: "Appearance" },
  },
];

/**
 * Looks at what the user asked and returns at most one real in-app screen
 * link, or null when nothing clearly matches — most turns get none.
 */
export function matchHelpLink(userText: string | undefined): HelpLink | null {
  if (!userText) return null;
  for (const rule of RULES) {
    if (rule.keywords.test(userText)) return rule.link;
  }
  return null;
}
