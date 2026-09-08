// Task categories to generate synthetic training examples for, mirroring
// NexaAi's real feature surface (see server/src/lib/anthropic.ts and
// chat.ts's message `kind`s). Each category's seed prompts are real
// examples to riff variations from — the generator asks the teacher model
// to invent NEW user messages inspired by these, not just repeat them
// verbatim, so the dataset has genuine variety.

export type AnswerMode = "strong" | "extra" | "normal";
export type MessageKind = "text" | "who_is_lookup" | "assistance_request" | "camera_ask";

export interface Topic {
  category: string;
  kind: MessageKind;
  description: string;
  answerModeWeights: Record<AnswerMode, number>; // relative sampling weight
  seedPrompts: string[];
}

export const TOPICS: Topic[] = [
  {
    category: "car_trouble",
    kind: "assistance_request",
    description: "A real-world car problem needing DIY triage steps plus a nudge toward the app's nearest-business lookup.",
    answerModeWeights: { strong: 1, extra: 2, normal: 2 },
    seedPrompts: [
      "my car is making a grinding noise when I brake",
      "check engine light just turned on, what do I do",
      "car won't start, just clicks when I turn the key",
      "there's a burning smell coming from under the hood",
      "my tire pressure light is on but the tires look fine",
      "AC blows warm air only when idling",
      "car is overheating on the highway",
      "steering wheel shakes at high speed",
    ],
  },
  {
    category: "baking_cooking",
    kind: "text",
    description: "A cooking/baking task broken into clear numbered steps.",
    answerModeWeights: { strong: 1, extra: 2, normal: 3 },
    seedPrompts: [
      "how do I bake a basic vanilla cake from scratch",
      "how do I make sourdough bread without a starter already made",
      "what's the easiest way to make homemade pasta",
      "how do I caramelize onions properly",
      "how do I make a cake gluten free without it falling apart",
      "how do I temper chocolate at home",
      "what's a good beginner recipe for macarons",
    ],
  },
  {
    category: "investing_finance",
    kind: "text",
    description: "Investment/money questions — confident, structured, with a clear 'where to start' line and no fake certainty about future prices.",
    answerModeWeights: { strong: 2, extra: 2, normal: 2 },
    seedPrompts: [
      "how can I make money with dropshipping",
      "what stock should I invest in as a beginner",
      "how do I start investing with $500",
      "what's the difference between an ETF and a mutual fund",
      "should I pay off debt or invest first",
      "how do I start a Roth IRA",
      "what's dollar-cost averaging",
    ],
  },
  {
    category: "who_is_lookup",
    kind: "who_is_lookup",
    description: "A 'who is X' public-figure question — only confident, genuinely public info, honest when uncertain.",
    answerModeWeights: { strong: 3, extra: 1, normal: 1 },
    seedPrompts: [
      "who is Elon Musk",
      "who is Taylor Swift",
      "who is the current CEO of a major tech company (invent a plausible real-sounding one)",
      "who is a well known chess player",
      "who is a famous physicist from the 20th century",
    ],
  },
  {
    category: "tech_troubleshooting",
    kind: "text",
    description: "A phone/computer/app troubleshooting question with concrete steps.",
    answerModeWeights: { strong: 2, extra: 2, normal: 2 },
    seedPrompts: [
      "my phone battery is draining really fast all of a sudden",
      "my wifi keeps disconnecting every few minutes",
      "my laptop fan is really loud and it's hot",
      "an app keeps crashing on my phone",
      "how do I free up storage space on my phone",
      "my bluetooth headphones won't pair anymore",
    ],
  },
  {
    category: "health_and_fitness",
    kind: "text",
    description: "General wellness/fitness guidance — practical steps, explicitly not a medical diagnosis, suggest seeing a professional for anything serious.",
    answerModeWeights: { strong: 1, extra: 2, normal: 2 },
    seedPrompts: [
      "how do I start running as a complete beginner",
      "what's a good beginner home workout routine with no equipment",
      "how much water should I actually be drinking a day",
      "how do I improve my sleep schedule",
      "what stretches help with a stiff lower back",
    ],
  },
  {
    category: "travel_planning",
    kind: "text",
    description: "Trip-planning questions with concrete, actionable steps.",
    answerModeWeights: { strong: 1, extra: 2, normal: 2 },
    seedPrompts: [
      "how do I plan a budget trip to Japan",
      "what should I pack for a week of backpacking",
      "how far in advance should I book international flights",
      "how do I find cheap accommodation for a solo trip",
    ],
  },
  {
    category: "camera_ask_described",
    kind: "camera_ask",
    description: "The user describes a photo they've taken (since synthetic generation can't produce real images) and asks about it — answer as if the described contents were seen.",
    answerModeWeights: { strong: 2, extra: 2, normal: 1 },
    seedPrompts: [
      "[photo: a rash on a forearm, red and slightly raised] what could this be",
      "[photo: a plant with yellowing, drooping leaves in a pot] what's wrong with my plant",
      "[photo: an error message on a laptop screen, generic 'disk read error'] what does this mean",
      "[photo: a moldy-looking spot on a bathroom ceiling corner] is this a problem",
      "[photo: a dashboard warning light shaped like an exclamation mark] what does this warning light mean",
    ],
  },
  {
    category: "agent_builder_draft",
    kind: "text",
    description: "Drafting an automated reply for a business's Instagram DM or WhatsApp autoresponder agent, matching lib/agents/agentRunner.ts's dryRunAgent framing.",
    answerModeWeights: { strong: 3, extra: 1, normal: 1 },
    seedPrompts: [
      "draft a reply to an Instagram DM asking about pricing for a small bakery's custom cakes",
      "draft a WhatsApp autoresponder for a hair salon getting a booking request after hours",
      "draft a reply to a DM asking if a clothing brand ships internationally",
      "draft a reply to a customer asking about return policy for an online store",
    ],
  },
];
