---
name: ask-user
description: How to use the ask_user tool to request information from the user — phrasing, when to ask, and how to format multiple-choice or multi-select options.
---

# Using the `ask_user` tool

`ask_user` pauses the run and shows a question card in the chat UI. The user can pick a suggested option, type a freeform reply, or skip. Use it when you genuinely cannot continue without the user's input — never for trivial clarifications you can make a reasonable call on.

## When to ask

Ask when:

- You need a decision only the user can make (which file, which account, which approach).
- A reasonable wrong guess would waste significant work or be hard to reverse.
- You need missing information (a name, a URL, a value) that isn't anywhere in the conversation, attachments, or memory.

Do not ask when:

- You can make a sensible default choice and let the user redirect you.
- The answer is inferable from context, recent messages, or the user's previous behavior.
- The question is just "are you sure?" — proceed and let them stop you.

## One question per call

`ask_user` accepts a single `question` (max 500 chars). If you need multiple pieces of information, ask them **one at a time across separate tool calls** — wait for each answer before asking the next. Bundling several questions into one prompt produces confused answers and is harder to read.

It is fine, however, to plan ahead: ask the most blocking question first, decide whether the answer makes the rest moot, and only ask the follow-up if it's still needed.

## Schema

```ts
{
  question: string;            // <= 500 chars, one focused question
  options?: {                  // <= 10 entries, optional
    label: string;             // <= 100 chars, the visible choice
    description?: string;      // <= 200 chars, secondary detail
  }[];
  multiSelect?: boolean;       // default false — let user pick several
  allowFreeformInput?: boolean;// default true — let user type their own answer
  context?: string;            // <= 200 chars, why you are asking (shown to user)
}
```

## Phrasing the question

- End with a question mark.
- Be specific. "Which environment should I deploy to?" beats "Where?"
- Don't restate the whole problem — the user has the conversation; one short sentence is plenty.
- Don't reference internal artifacts the user can't see (e.g. "the plan", "your TODO list" if it's hidden).

## Choosing options vs. freeform

- **No options** — when the answer is open-ended (a name, a URL, free text). Just set `question` and leave `options` out; `allowFreeformInput` defaults to `true`.
- **Options, freeform allowed** (default) — when there are obvious choices but the user might want something else. This is the common case.
- **Options, freeform disabled** — only when freeform answers genuinely cannot be handled (e.g. you can only act on the listed enum values). Set `allowFreeformInput: false` explicitly.
- **multiSelect: true** — when choices are not mutually exclusive ("which of these files should I update?", "which features to enable?"). Phrase the question in plural form to match.

Cap options at what's actually useful — typically 2–5. Ten is the hard limit, not a target.

If you recommend one option, put it first and append " (recommended)" to its label so the user can scan quickly.

## Writing good options

- Each `label` is the choice itself, in 1–5 words. Not a full sentence.
- Use `description` for the tradeoff or consequence: "Faster but uses more memory", "Requires re-auth".
- Make labels mutually distinct — if two options sound the same, collapse them.

## Example calls

Single choice with a recommendation:

```json
{
  "question": "Which package manager should I use?",
  "context": "package.json has both yarn.lock and package-lock.json",
  "options": [
    {
      "label": "yarn (recommended)",
      "description": "yarn.lock is newer and matches CI"
    },
    { "label": "npm", "description": "Matches package-lock.json" }
  ]
}
```

Multi-select:

```json
{
  "question": "Which environments should I run the migration against?",
  "multiSelect": true,
  "options": [
    { "label": "dev" },
    { "label": "staging" },
    { "label": "prod", "description": "Requires on-call sign-off" }
  ]
}
```

Freeform (no options):

```json
{
  "question": "What should the new workspace be called?",
  "context": "Used as both the slug and the display name."
}
```

## Handling the response

The tool returns a text string describing what the user selected or typed. Three special cases:

- **Timed out** — the user didn't respond in 15 minutes. Continue with your best judgment and say so briefly.
- **Skipped** — the user explicitly chose to let you decide. Continue with your best judgment.
- **Empty response** — treat the same as skipped.

If the user picked options _and_ added freeform text, both are returned — read both and let the freeform refine your interpretation of the selection.

## Availability

`ask_user` only works in an interactive top-level session. In subagents, scheduled runs, or non-streaming contexts, the tool returns a notice that it's unavailable and you should proceed with your best judgment. Don't loop trying to call it; just make the call yourself.
