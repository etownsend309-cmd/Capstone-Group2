import { useEffect, useState } from "react";

import { formatCount, formatMs, formatPageList, statusLabel } from "../format";
import { FALLBACK_REASON_LABELS } from "../../pdf/evaluateExtraction";
import type { ExtractionRun, StrategyId, StrategyResult } from "../../pdf/types";

interface Props {
  run: ExtractionRun;
  markedUnusable: boolean;
  onMarkUnusable: (marked: boolean) => void;
}

export function ExtractionResults({ run, markedUnusable, onMarkUnusable }: Props) {
  const totalWarnings =
    run.warnings.length + run.strategies.reduce((sum, s) => sum + s.warnings.length, 0);

  return (
    <>
      <section className="panel" aria-labelledby="summary-heading">
        <h2 id="summary-heading">
          <span className="step-number" aria-hidden="true">
            2
          </span>
          Results summary
          <span className={`badge ${run.status}`} data-testid="overall-status">
            {statusLabel(run.status)}
          </span>
        </h2>
        <p className="panel-hint">
          PDF.js {run.pdfjsVersion} parsed <code>{run.fileName}</code> once; both strategies
          reconstruct text from that single parse.
        </p>

        <dl className="metrics" data-testid="summary-metrics">
          <div>
            <dt>Pages</dt>
            <dd data-testid="summary-pages">{formatCount(run.pageCount)}</dd>
          </div>
          <div>
            <dt>Total time</dt>
            <dd data-testid="summary-time">{formatMs(run.totalElapsedMs)}</dd>
          </div>
          <div>
            <dt>Characters</dt>
            <dd data-testid="summary-chars">
              {formatCount(run.strategies[0]?.printableCharacterCount ?? 0)}
            </dd>
          </div>
          <div>
            <dt>Empty pages</dt>
            <dd data-testid="summary-empty">
              {formatCount(run.strategies[0]?.emptyPages.length ?? 0)}
            </dd>
          </div>
          <div>
            <dt>Warnings</dt>
            <dd data-testid="summary-warnings">{formatCount(totalWarnings)}</dd>
          </div>
          <div>
            <dt>Plaintext fallback</dt>
            <dd data-testid="summary-fallback">
              {run.fallbackRecommended ? "Recommended" : "Not needed"}
            </dd>
          </div>
        </dl>

        {run.error && (
          <div className="alert error" role="alert" data-testid="run-error">
            <h3>Extraction failed</h3>
            <p>{run.error}</p>
          </div>
        )}

        {run.warnings.length > 0 && (
          <div className="alert warn" role="status" data-testid="run-warnings">
            <h3>What PDF.js reported</h3>
            <ul>
              {run.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </div>
        )}

        {run.fallbackReasons.length > 0 && (
          <div className="alert warn" role="status" data-testid="run-reasons">
            <h3>Fallback rules that fired</h3>
            <ul>
              {run.fallbackReasons.map((reason) => (
                <li key={reason}>
                  <code>{reason}</code> - {FALLBACK_REASON_LABELS[reason] ?? reason}
                </li>
              ))}
            </ul>
          </div>
        )}

        <label className="check-label" style={{ marginTop: "1rem" }}>
          <input
            type="checkbox"
            checked={markedUnusable}
            onChange={(event) => onMarkUnusable(event.target.checked)}
            data-testid="mark-unusable"
          />
          Mark this extraction unusable (missing text or wrong reading order)
        </label>
      </section>

      <StrategyComparison strategies={run.strategies} />
    </>
  );
}

function StrategyComparison({ strategies }: { strategies: StrategyResult[] }) {
  const withText = strategies.filter((s) => s.text.trim().length > 0);
  const [leftKey, setLeftKey] = useState<StrategyId | "">("");
  const [rightKey, setRightKey] = useState<StrategyId | "">("");

  useEffect(() => {
    setLeftKey(withText[0]?.strategy ?? "");
    setRightKey(withText[1]?.strategy ?? withText[0]?.strategy ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strategies]);

  const left = strategies.find((s) => s.strategy === leftKey);
  const right = strategies.find((s) => s.strategy === rightKey);

  return (
    <section className="panel" aria-labelledby="strategies-heading">
      <h2 id="strategies-heading">
        <span className="step-number" aria-hidden="true">
          3
        </span>
        Strategy comparison
      </h2>
      <p className="panel-hint">
        Both strategies read the same PDF.js output. This compares two ways of{" "}
        <strong>reconstructing</strong> text, not two independent PDF engines. Character count is a
        volume measure: identical counts can still mean completely different reading order, so read
        the text before preferring one.
      </p>

      <div className="result-grid">
        {strategies.map((strategy) => (
          <StrategyCard key={strategy.strategy} strategy={strategy} />
        ))}
      </div>

      {withText.length > 0 && (
        <>
          <div className="pane-picker">
            <label className="field" style={{ marginBottom: 0 }}>
              <span>Left pane</span>
              <select
                value={leftKey}
                onChange={(event) => setLeftKey(event.target.value as StrategyId)}
                data-testid="left-pane-select"
              >
                {withText.map((s) => (
                  <option key={s.strategy} value={s.strategy}>
                    {s.strategyName}
                  </option>
                ))}
              </select>
            </label>
            <label className="field" style={{ marginBottom: 0 }}>
              <span>Right pane</span>
              <select
                value={rightKey}
                onChange={(event) => setRightKey(event.target.value as StrategyId)}
                data-testid="right-pane-select"
              >
                {withText.map((s) => (
                  <option key={s.strategy} value={s.strategy}>
                    {s.strategyName}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="side-by-side">
            {[
              { result: left, side: "left" },
              { result: right, side: "right" },
            ].map(({ result, side }) =>
              result ? (
                <div className="pane" key={side}>
                  <h4>
                    {result.strategyName} &middot;{" "}
                    {formatCount(result.printableCharacterCount)} printable chars
                  </h4>
                  <pre data-testid={`pane-${side}`}>{result.text}</pre>
                </div>
              ) : null,
            )}
          </div>
        </>
      )}
    </section>
  );
}

function StrategyCard({ strategy }: { strategy: StrategyResult }) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const hasText = strategy.text.length > 0;

  async function copyText() {
    try {
      await navigator.clipboard.writeText(strategy.text);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
    setTimeout(() => setCopyState("idle"), 2500);
  }

  function downloadText() {
    const blob = new Blob([strategy.text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `extracted-${strategy.strategy}.txt`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  return (
    <article
      className={`result-card status-${strategy.status}`}
      data-testid={`strategy-${strategy.strategy}`}
      data-status={strategy.status}
      aria-labelledby={`heading-${strategy.strategy}`}
    >
      <header className="result-head">
        <h3 id={`heading-${strategy.strategy}`}>{strategy.strategyName}</h3>
        <span className={`badge ${strategy.status}`} data-testid={`status-${strategy.strategy}`}>
          {statusLabel(strategy.status)}
        </span>
      </header>

      <p className="footnote" style={{ marginTop: 0 }}>
        {strategy.strategyDescription}
      </p>

      <dl className="metrics">
        <div>
          <dt>Latency</dt>
          <dd data-testid={`latency-${strategy.strategy}`}>{formatMs(strategy.elapsedMs)}</dd>
        </div>
        <div>
          <dt>Printable chars</dt>
          <dd data-testid={`printable-${strategy.strategy}`}>
            {formatCount(strategy.printableCharacterCount)}
          </dd>
        </div>
        <div>
          <dt>Raw chars</dt>
          <dd>{formatCount(strategy.characterCount)}</dd>
        </div>
        <div>
          <dt>Empty pages</dt>
          <dd data-testid={`empty-${strategy.strategy}`}>{strategy.emptyPages.length}</dd>
        </div>
      </dl>

      {strategy.charactersPerPage.length > 0 && (
        <p className="per-page">
          <strong>Printable characters per page:</strong>{" "}
          {strategy.printableCharactersPerPage.map((n, i) => `p${i + 1}=${n}`).join("  ")}
          {strategy.emptyPages.length > 0 && (
            <>
              <br />
              <strong>Empty pages:</strong> {formatPageList(strategy.emptyPages)}
            </>
          )}
        </p>
      )}

      {strategy.warnings.length > 0 && (
        <ul className="warn-list" data-testid={`warnings-${strategy.strategy}`}>
          {strategy.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}

      {hasText ? (
        <>
          <details data-testid={`text-details-${strategy.strategy}`}>
            <summary>Extracted text ({formatCount(strategy.characterCount)} characters)</summary>
            <pre className="extracted-text" data-testid={`text-${strategy.strategy}`}>
              {strategy.text}
            </pre>
          </details>
          <div className="actions" style={{ marginTop: 0 }}>
            <button
              type="button"
              className="small"
              onClick={copyText}
              data-testid={`copy-${strategy.strategy}`}
            >
              {copyState === "copied"
                ? "Copied"
                : copyState === "error"
                  ? "Copy blocked by browser"
                  : "Copy text"}
            </button>
            <button
              type="button"
              className="small"
              onClick={downloadText}
              data-testid={`download-${strategy.strategy}`}
            >
              Download .txt
            </button>
          </div>
        </>
      ) : (
        <p className="error-line" data-testid={`no-text-${strategy.strategy}`}>
          No text was produced, so there is nothing to copy or download.
        </p>
      )}
    </article>
  );
}
