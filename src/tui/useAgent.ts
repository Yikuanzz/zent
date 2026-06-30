/**
 * useAgent: the bridge between the pure core loop (async generator) and React.
 *
 *   - drives runAgent(), translating AgentEvents into view state
 *   - handles approval by awaiting a Promise resolved from the UI
 *   - cancels via AbortController and returns the generator on unmount
 *     (preventing leaks / background execution of dangerous tools)
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { runAgent } from '../core/agent.ts';
import { computeCost } from '../core/cost.ts';
import type {
  AgentEvent,
  ApprovalDecision,
  Config,
  LLMClient,
  Message,
  Tool,
  ToolCall,
  TokenUsage,
} from '../core/types.ts';
import type { SessionLogger } from '../core/logger.ts';
import type { DisplayItem, PlanState } from './types.ts';

interface UseAgentArgs {
  config: Config;
  client: LLMClient;
  tools: Record<string, Tool>;
  systemPrompt: string;
  logger?: SessionLogger;
}

export interface UseAgent {
  items: DisplayItem[];
  isRunning: boolean;
  plan: PlanState;
  usage: TokenUsage | null;
  cost: number | null;
  iteration: number;
  pendingApproval: ToolCall | null;
  runStartedAt: number;
  submit: (displayText: string, modelText?: string) => void;
  respondApproval: (approved: boolean, remember?: boolean) => void;
  abort: () => void;
  toggleCollapse: (id: number) => void;
  expandLatestTool: () => void;
}

export function useAgent(args: UseAgentArgs): UseAgent {
  const { config, client, tools, systemPrompt, logger } = args;

  const [items, setItems] = useState<DisplayItem[]>([]);
  const [isRunning, setRunning] = useState(false);
  const [plan, setPlan] = useState<PlanState>({ steps: [] });
  const [usage, setUsage] = useState<TokenUsage | null>(null);
  const [iteration, setIteration] = useState(0);
  const [pendingApproval, setPendingApproval] = useState<ToolCall | null>(null);
  const [runStartedAt, setRunStartedAt] = useState(0);

  const messagesRef = useRef<Message[]>([{ role: 'system', content: systemPrompt }]);
  const abortRef = useRef<AbortController | null>(null);
  const approvalResolver = useRef<((d: ApprovalDecision) => void) | null>(null);
  const pendingCallRef = useRef<ToolCall | null>(null);
  const alwaysApprove = useRef<Set<string>>(new Set());
  const idRef = useRef(0);
  const liveThinkingId = useRef<number | null>(null);
  const lastAssistantText = useRef('');
  const mounted = useRef(true);

  const nextId = () => ++idRef.current;

  // ── cleanup on unmount: abort + return generator ───────────────────────────
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      abortRef.current?.abort();
      approvalResolver.current?.({ approved: false });
    };
  }, []);

  const applyEvent = useCallback((e: AgentEvent) => {
    switch (e.type) {
      case 'turn_start':
        setIteration(e.iteration + 1);
        break;
      case 'thinking':
        setItems((prev) => {
          const next = [...prev];
          if (liveThinkingId.current == null) {
            const id = nextId();
            liveThinkingId.current = id;
            next.push({ kind: 'assistant', id, text: e.delta, done: false });
          } else {
            const idx = next.findIndex((it) => it.id === liveThinkingId.current);
            if (idx >= 0 && next[idx]!.kind === 'assistant') {
              next[idx] = { ...next[idx], text: (next[idx] as { text: string }).text + e.delta } as DisplayItem;
            }
          }
          return next;
        });
        break;
      case 'assistant_message':
        // Finalize the streamed assistant block (renders as markdown when done).
        lastAssistantText.current = e.content;
        setItems((prev) =>
          prev.map((it) =>
            it.kind === 'assistant' && it.id === liveThinkingId.current
              ? { ...it, text: e.content, done: true }
              : it,
          ),
        );
        liveThinkingId.current = null;
        break;
      case 'tool_start':
        liveThinkingId.current = null;
        // update_plan is visualized only as the inline plan checklist, not as a tool line.
        if (e.call.name === 'update_plan') break;
        setItems((prev) => [
          ...prev,
          {
            kind: 'tool',
            id: nextId(),
            callId: e.call.id,
            name: e.call.name,
            args: e.call.args,
            status: e.dangerous ? 'awaiting' : 'running',
            summary: e.dangerous ? 'waiting for approval…' : `${e.call.name} running…`,
            full: '',
            durationMs: 0,
            collapsed: true,
          },
        ]);
        break;
      case 'tool_end':
        setItems((prev) =>
          prev.map((it) =>
            it.kind === 'tool' && it.callId === e.callId
              ? { ...it, status: e.ok ? 'ok' : 'failed', summary: e.summary, full: e.full, durationMs: e.durationMs }
              : it,
          ),
        );
        break;
      case 'tool_denied':
        setItems((prev) =>
          prev.map((it) =>
            it.kind === 'tool' && it.callId === e.call.id
              ? { ...it, status: 'denied', summary: `已拒绝: ${e.call.name}` }
              : it,
          ),
        );
        break;
      case 'plan_update':
        setPlan({ steps: e.steps });
        // Render the plan inline (single-column layout). Replace the trailing
        // plan block if the previous item is already a plan, so consecutive
        // updates collapse into one evolving checklist.
        setItems((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.kind === 'plan') {
            const next = [...prev];
            next[next.length - 1] = { ...last, steps: e.steps };
            return next;
          }
          return [...prev, { kind: 'plan', id: nextId(), steps: e.steps }];
        });
        break;
      case 'token_usage':
        setUsage(e.usage);
        break;
      case 'finish': {
        // Skip empty (natural stop — answer already shown) or content that
        // merely repeats the last assistant message.
        const summary = e.summary.trim();
        const last = lastAssistantText.current.trim();
        if (summary && summary !== last) {
          setItems((prev) => [...prev, { kind: 'finish', id: nextId(), text: e.summary }]);
        }
        break;
      }
      case 'error':
        setItems((prev) => [...prev, { kind: 'error', id: nextId(), text: e.message }]);
        break;
      case 'aborted':
        setItems((prev) => [...prev, { kind: 'error', id: nextId(), text: '已中断当前任务。' }]);
        break;
    }
  }, []);

  const submit = useCallback(
    (displayText: string, modelText?: string) => {
      if (isRunning || !displayText.trim()) return;
      messagesRef.current.push({ role: 'user', content: modelText ?? displayText });
      logger?.logUser(displayText);
      setItems((prev) => [...prev, { kind: 'user', id: nextId(), text: displayText }]);
      setRunning(true);
      setRunStartedAt(Date.now());
      liveThinkingId.current = null;
      lastAssistantText.current = '';

      const controller = new AbortController();
      abortRef.current = controller;
      const gen = runAgent({
        messages: messagesRef.current,
        client,
        config,
        signal: controller.signal,
        tools,
      });

      (async () => {
        let pending: ApprovalDecision = undefined;
        try {
          while (true) {
            const { value, done } = await gen.next(pending);
            pending = undefined;
            if (done || !value) break;
            if (!mounted.current) {
              await gen.return();
              break;
            }
            logger?.logEvent(value);
            if (value.type === 'approval_required') {
              const call = value.call;
              if (alwaysApprove.current.has(call.name)) {
                // Previously approved "don't ask again" for this tool.
                setItems((prev) =>
                  prev.map((it) =>
                    it.kind === 'tool' && it.callId === call.id
                      ? { ...it, status: 'running', summary: `${call.name} running…` }
                      : it,
                  ),
                );
                pending = { approved: true };
              } else {
                pendingCallRef.current = call;
                setPendingApproval(call);
                const decision = await new Promise<ApprovalDecision>((resolve) => {
                  approvalResolver.current = resolve;
                });
                approvalResolver.current = null;
                setPendingApproval(null);
                pendingCallRef.current = null;
                // Reflect the decision on the tool card before it runs.
                if (decision?.approved) {
                  setItems((prev) =>
                    prev.map((it) =>
                      it.kind === 'tool' && it.callId === call.id
                        ? { ...it, status: 'running', summary: `${call.name} running…` }
                        : it,
                    ),
                  );
                }
                pending = decision;
              }
            } else {
              applyEvent(value);
            }
          }
        } catch (err) {
          if (mounted.current) {
            setItems((prev) => [...prev, { kind: 'error', id: nextId(), text: String(err) }]);
          }
        } finally {
          if (mounted.current) setRunning(false);
          abortRef.current = null;
        }
      })();
    },
    [isRunning, client, config, tools, logger, applyEvent],
  );

  const respondApproval = useCallback((approved: boolean, remember: boolean = false) => {
    if (remember && approved && pendingCallRef.current) {
      alwaysApprove.current.add(pendingCallRef.current.name);
    }
    approvalResolver.current?.({ approved });
  }, []);

  const abort = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const toggleCollapse = useCallback((id: number) => {
    setItems((prev) =>
      prev.map((it) => (it.kind === 'tool' && it.id === id ? { ...it, collapsed: !it.collapsed } : it)),
    );
  }, []);

  const expandLatestTool = useCallback(() => {
    setItems((prev) => {
      const next = [...prev];
      for (let i = next.length - 1; i >= 0; i--) {
        const it = next[i]!;
        if (it.kind === 'tool') {
          next[i] = { ...it, collapsed: !it.collapsed };
          break;
        }
      }
      return next;
    });
  }, []);

  const cost = usage ? computeCost(usage, config.pricing) : null;

  return {
    items,
    isRunning,
    plan,
    usage,
    cost,
    iteration,
    pendingApproval,
    runStartedAt,
    submit,
    respondApproval,
    abort,
    toggleCollapse,
    expandLatestTool,
  };
}
