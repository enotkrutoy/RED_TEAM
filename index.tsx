import React, { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { GoogleGenAI, Type, Schema } from "@google/genai";

// Initialize Gemini
// Note: process.env.API_KEY is replaced by Vite during build
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

// Types
interface DorkResponse {
  dork: string;
  explanation: string;
  riskLevel: "INFO" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  suggestedOperators: string[];
  validationAnalysis: string;
  improvementReasoning: string;
  refinedObjective: string;
}

interface HistoryItem {
  timestamp: number;
  input: string;
  response: DorkResponse;
}

// Component: Syntax Highlighter for Dorks
const DorkHighlighter = ({ dork }: { dork: string }) => {
  if (!dork) return <span className="text-muted opacity-25">Awaiting input stream...</span>;

  // Split by common operators to highlight them
  const parts = dork.split(/(\s+|\||\(|\)|site:|inurl:|intitle:|filetype:|ext:|intext:|-site:|-inurl:)/g);

  return (
    <span className="dork-code">
      {parts.map((part, i) => {
        if (/^(site:|inurl:|intitle:|filetype:|ext:|intext:|-site:|-inurl:)$/.test(part)) {
          return <span key={i} className="text-info fw-bold">{part}</span>;
        } else if (/^(\||\(|\))$/.test(part)) {
          return <span key={i} className="text-warning fw-bold">{part}</span>;
        } else if (/^".*"$/.test(part)) {
           return <span key={i} className="text-success">{part}</span>;
        } else {
          return <span key={i} className="text-light">{part}</span>;
        }
      })}
    </span>
  );
};

const App = () => {
  // State
  const [naturalInput, setNaturalInput] = useState("");
  const [dork, setDork] = useState("");
  const [analysis, setAnalysis] = useState<DorkResponse | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syntaxErrors, setSyntaxErrors] = useState<string[]>([]);
  const [showManual, setShowManual] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState(false);

  // Advanced Mode State (Manual Overrides)
  const [manualParams, setManualParams] = useState({
    site: "",
    inurl: "",
    intitle: "",
    filetype: "",
    textquery: ""
  });

  // Check for API Key on mount
  useEffect(() => {
    if (!process.env.API_KEY) {
        setError("SYSTEM ALERT: API_KEY is missing. Configure Vercel Environment Variables.");
    }
  }, []);

  // Effect to sync manual params to dork string if analysis is null (manual mode)
  useEffect(() => {
    if (!analysis) {
      let parts = [];
      if (manualParams.site) parts.push(`site:${manualParams.site}`);
      if (manualParams.inurl) parts.push(`inurl:${manualParams.inurl}`);
      if (manualParams.intitle) parts.push(`intitle:"${manualParams.intitle}"`);
      if (manualParams.filetype) parts.push(`filetype:${manualParams.filetype}`);
      if (manualParams.textquery) parts.push(`"${manualParams.textquery}"`);
      
      if (parts.length > 0) {
        setDork(parts.join(" "));
      }
    }
  }, [manualParams, analysis]);

  const handleManualChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setAnalysis(null); // Switch back to manual mode visually
    setManualParams({
      ...manualParams,
      [e.target.name]: e.target.value
    });
  };

  const handleCopy = () => {
    if (!dork) return;
    navigator.clipboard.writeText(dork);
    setCopyFeedback(true);
    setTimeout(() => setCopyFeedback(false), 2000);
  };

  const validatePayload = (payload: string): string[] => {
    const issues: string[] = [];
    // 1. Check for Cyrillic
    if (/[а-яА-ЯёЁ]/.test(payload)) {
        issues.push("CRITICAL: Cyrillic characters detected in Dork. Google Operators must be ASCII.");
    }
    // 2. Check for unbalanced quotes
    const quoteCount = (payload.match(/"/g) || []).length;
    if (quoteCount % 2 !== 0) {
        issues.push("SYNTAX ERROR: Unbalanced quotes detected. Ensure all strings are closed.");
    }
    // 3. Check for bad spacing (e.g., "ext: php")
    if (/(ext|site|inurl|intitle):\s+/.test(payload)) {
        issues.push("SYNTAX WARNING: Space detected after operator colon (e.g. 'ext: pdf'). Remove space.");
    }
    return issues;
  };

  const handleOptimizePrompt = async () => {
    if (!naturalInput.trim()) return;
    if (!process.env.API_KEY) {
        setError("API Key missing.");
        return;
    }
    
    setIsOptimizing(true);
    setError(null);
    try {
        const result = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: `Act as a Red Team Lead. Rewrite the following user request into a precise, high-context technical objective for a Google Dork generation AI. 
            
            Current Request: "${naturalInput}"
            
            Rules:
            1. Use professional cybersecurity terminology (GHDB).
            2. Be specific about targets, file extensions, and vulnerability types (SQLi, IDOR, Exposed Env, etc.).
            3. Keep it concise but detailed enough for an AI to generate the perfect GHDB query.
            4. Output ONLY the rewritten prompt text.`,
        });
        
        if (result.text) {
            setNaturalInput(result.text.trim());
        }
    } catch (e) {
        console.error(e);
        setError("Optimization failed. Check connectivity.");
    } finally {
        setIsOptimizing(false);
    }
  };

  const generateWithAI = async (overrideInput?: string) => {
    const inputToUse = overrideInput || naturalInput;
    if (!inputToUse.trim()) return;
    if (!process.env.API_KEY) {
        setError("ABORTED: API Key not found.");
        return;
    }

    setIsLoading(true);
    setError(null);
    setSyntaxErrors([]);
    setAnalysis(null);

    try {
      const prompt = `Role: Elite Red Team OSINT Specialist.
      Knowledge Base: Google Hacking Database (GHDB - exploit-db.com).
      
      Input Objective: "${inputToUse}"
      
      Task:
      1. Generate a specialized Google Dork based on GHDB patterns to achieve the objective.
      2. STRICT RULE: The 'dork' field must contain ONLY ASCII CHARACTERS. Absolutely NO CYRILLIC (Russian) characters in the final dork string. If the target is Russian, use 'site:.ru' or transliterated keywords (e.g., 'paroli' not 'пароли').
      3. SYNTAX SAFETY: Ensure all quotes are balanced. Isolate special characters correctly.
      4. STRATEGY: Analyze how this query could be improved or what it might miss, and propose a refined objective.
      
      Output Fields:
      - dork: The query string (ASCII ONLY).
      - explanation: Tactical analysis in Russian.
      - riskLevel: Assessment.
      - validationAnalysis: Syntax and logic check in Russian.
      - improvementReasoning: Explanation of how to deepen the search (in Russian).
      - refinedObjective: A specific, better prompt for the next iteration.`;

      const responseSchema: Schema = {
        type: Type.OBJECT,
        properties: {
          dork: { type: Type.STRING, description: "The Google search query (ASCII ONLY)" },
          explanation: { type: Type.STRING, description: "Detailed tactical analysis in Russian" },
          riskLevel: { type: Type.STRING, enum: ["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"] },
          suggestedOperators: { 
            type: Type.ARRAY, 
            items: { type: Type.STRING },
            description: "List of 3 refined operators to narrow down results"
          },
          validationAnalysis: {
            type: Type.STRING,
            description: "Self-correction assessment in Russian"
          },
          improvementReasoning: {
            type: Type.STRING,
            description: "Reasoning on how to improve the result (in Russian)"
          },
          refinedObjective: {
            type: Type.STRING,
            description: "A refined natural language prompt for the next iteration"
          }
        },
        required: ["dork", "explanation", "riskLevel", "suggestedOperators", "validationAnalysis", "improvementReasoning", "refinedObjective"]
      };

      const result = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: responseSchema,
          systemInstruction: "You are an autonomous AI cyber-security assistant. Your primary directive is to generate syntacticly perfect Google Dorks. You must NEVER use Cyrillic characters in the 'dork' field."
        }
      });

      if (result.text) {
        const data: DorkResponse = JSON.parse(result.text);
        
        // Client-side validation
        const validationIssues = validatePayload(data.dork);
        setSyntaxErrors(validationIssues);

        setDork(data.dork);
        setAnalysis(data);
        
        // Add to history
        setHistory(prev => [{
            timestamp: Date.now(),
            input: inputToUse,
            response: data
        }, ...prev].slice(0, 10)); // Keep last 10

        // Clear manual inputs on AI success
        setManualParams({
            site: "",
            inurl: "",
            intitle: "",
            filetype: "",
            textquery: ""
        });
      }
    } catch (err: any) {
      console.error(err);
      let errorMsg = "UPLINK ERROR: Unable to generate strategy.";
      if (err.message) errorMsg += ` [${err.message}]`;
      setError(errorMsg);
    } finally {
      setIsLoading(false);
    }
  };

  const handleApplyImprovement = () => {
    if (analysis && analysis.refinedObjective) {
        setNaturalInput(analysis.refinedObjective);
        generateWithAI(analysis.refinedObjective);
    }
  };

  const googleLink = `https://www.google.com/search?q=${encodeURIComponent(dork)}`;

  return (
    <div className="container py-4">
      {/* Header */}
      <header className="mb-4 border-bottom border-secondary pb-3">
        <div className="d-flex justify-content-between align-items-end">
          <div>
            <h1 className="display-6 terminal-font mb-0">
              <span className="text-success">&gt;</span> RED_TEAM_GENAI<span className="blink">_</span>
            </h1>
            <small className="text-muted text-uppercase ls-1">GHDB-Enhanced OSINT Generator</small>
          </div>
          <div className="text-end">
             <div className="badge border border-success text-success bg-transparent terminal-font">SYSTEM ONLINE</div>
          </div>
        </div>
      </header>

      <div className="row g-4">
        {/* Left Column: Input & Controls */}
        <div className="col-lg-5">
          <div className="card shadow-sm h-100">
            <div className="card-header bg-transparent border-bottom border-secondary">
              <h5 className="card-title mb-0 terminal-font text-info text-uppercase">
                <i className="bi bi-terminal-fill me-2"></i>Command Input
              </h5>
            </div>
            <div className="card-body d-flex flex-column">
              <div className="mb-3 flex-grow-1">
                <div className="d-flex justify-content-between align-items-center mb-2">
                    <label className="form-label text-muted text-uppercase small ls-1 mb-0">Target Parameters</label>
                    <button 
                        className="btn btn-sm btn-outline-info py-0 px-2 terminal-font border-0" 
                        style={{fontSize: '0.75rem'}}
                        onClick={handleOptimizePrompt}
                        disabled={isOptimizing || !naturalInput}
                        title="Rewrite input using expert terminology"
                    >
                        {isOptimizing ? <span className="spinner-border spinner-border-sm me-1"></span> : <i className="bi bi-magic me-1"></i>}
                        ENHANCE PROMPT
                    </button>
                </div>
                <textarea
                  className="form-control mb-3 terminal-input"
                  rows={5}
                  placeholder="Ex: Find public Jenkins dashboards on edu domains..."
                  value={naturalInput}
                  onChange={(e) => setNaturalInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                      generateWithAI();
                    }
                  }}
                ></textarea>
                
                <button 
                  className={`btn btn-primary w-100 position-relative overflow-hidden terminal-font ${isLoading ? 'disabled' : ''}`} 
                  onClick={() => generateWithAI()}
                >
                  {isLoading ? (
                    <>
                      <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
                      COMPUTING...
                    </>
                  ) : (
                    <>EXECUTE STRATEGY [CTRL+ENTER]</>
                  )}
                </button>
              </div>

              {/* Manual Override Toggle */}
              <div className="mt-auto">
                 <button 
                    className="btn btn-sm btn-link text-muted text-decoration-none px-0 w-100 text-start border-top border-secondary pt-2"
                    onClick={() => setShowManual(!showManual)}
                    type="button"
                 >
                    <i className={`bi bi-chevron-${showManual ? 'up' : 'down'} me-2`}></i>
                    MANUAL OVERRIDE PARAMETERS
                 </button>
                 
                 {showManual && (
                    <div className="mt-3 fade-in">
                        <div className="mb-2 input-group input-group-sm">
                        <span className="input-group-text text-uppercase">site</span>
                        <input type="text" className="form-control" name="site" value={manualParams.site} onChange={handleManualChange} placeholder="target.com" />
                        </div>
                        <div className="mb-2 input-group input-group-sm">
                        <span className="input-group-text text-uppercase">inurl</span>
                        <input type="text" className="form-control" name="inurl" value={manualParams.inurl} onChange={handleManualChange} placeholder="admin/login" />
                        </div>
                        <div className="mb-2 input-group input-group-sm">
                        <span className="input-group-text text-uppercase">filetype</span>
                        <input type="text" className="form-control" name="filetype" value={manualParams.filetype} onChange={handleManualChange} placeholder="env, log, sql" />
                        </div>
                        <div className="mb-2 input-group input-group-sm">
                        <span className="input-group-text text-uppercase">text</span>
                        <input type="text" className="form-control" name="textquery" value={manualParams.textquery} onChange={handleManualChange} placeholder="confidential" />
                        </div>
                    </div>
                 )}
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Analysis & Output */}
        <div className="col-lg-7">
           <div className="card shadow-sm h-100">
             <div className="card-header bg-transparent border-bottom border-secondary d-flex justify-content-between align-items-center">
                <h5 className="card-title mb-0 terminal-font text-success text-uppercase">
                  <i className="bi bi-cpu-fill me-2"></i>Analysis Output
                </h5>
                {analysis && (
                  <span className={`badge border ${
                    analysis.riskLevel === 'CRITICAL' || analysis.riskLevel === 'HIGH' 
                      ? 'border-danger text-danger' 
                      : analysis.riskLevel === 'MEDIUM' ? 'border-warning text-warning' : 'border-info text-info'
                  } bg-transparent terminal-font`}>
                    RISK: {analysis.riskLevel}
                  </span>
                )}
             </div>
             
             <div className="card-body">
                {error && (
                    <div className="alert alert-danger terminal-font border-danger d-flex align-items-center">
                        <i className="bi bi-exclamation-triangle-fill me-2"></i> {error}
                    </div>
                )}
                
                {/* Syntax Errors / Warnings */}
                {syntaxErrors.length > 0 && (
                     <div className="alert alert-danger terminal-font border-danger bg-danger bg-opacity-10">
                        <h6 className="fw-bold"><i className="bi bi-cone-striped me-2"></i>SYNTAX/ASCII ALERT</h6>
                        <ul className="mb-0 ps-3">
                            {syntaxErrors.map((err, i) => (
                                <li key={i}>{err}</li>
                            ))}
                        </ul>
                     </div>
                )}

                <div className="mb-4">
                    <label className="form-label text-muted text-uppercase small ls-1 d-flex justify-content-between">
                        <span>Generated Payload</span>
                        {copyFeedback && <span className="text-success fade-in">COPIED TO CLIPBOARD</span>}
                    </label>
                    <div className="dork-display position-relative" onClick={handleCopy} style={{cursor: 'pointer'}} title="Click to copy">
                        <DorkHighlighter dork={dork} />
                        <div className="position-absolute top-0 end-0 p-2 opacity-50">
                            <i className="bi bi-clipboard"></i>
                        </div>
                    </div>
                </div>

                <div className="row mb-4 g-2">
                    <div className="col-6">
                        <a 
                            href={dork ? googleLink : "#"} 
                            target="_blank" 
                            rel="noreferrer" 
                            className={`btn btn-outline-success w-100 terminal-font ${!dork ? 'disabled' : ''}`}
                        >
                            LAUNCH <i className="bi bi-box-arrow-up-right ms-2"></i>
                        </a>
                    </div>
                    <div className="col-6">
                        <button 
                            className={`btn btn-outline-secondary w-100 terminal-font ${!dork ? 'disabled' : ''}`}
                            onClick={handleCopy}
                        >
                            COPY PAYLOAD
                        </button>
                    </div>
                </div>

                {analysis ? (
                    <div className="analysis-container fade-in">
                        {/* Tactical Analysis */}
                        <div className="mb-3 p-3 border border-secondary border-opacity-25 rounded bg-dark bg-opacity-25">
                            <h6 className="terminal-font text-info mb-2 small text-uppercase fw-bold">
                                <i className="bi bi-crosshair me-2"></i>Tactical Analysis (RU)
                            </h6>
                            <p className="analysis-text mb-0">{analysis.explanation}</p>
                        </div>

                        {/* Optimization Strategy */}
                        <div className="mb-3 p-3 border border-secondary border-opacity-25 rounded bg-dark bg-opacity-10">
                            <div className="d-flex justify-content-between align-items-start mb-2">
                                <h6 className="terminal-font text-warning mb-0 small text-uppercase fw-bold">
                                    <i className="bi bi-arrow-up-circle me-2"></i>Optimization Strategy (RU)
                                </h6>
                            </div>
                            <p className="analysis-text text-light small mb-3">{analysis.improvementReasoning}</p>
                            
                            {analysis.refinedObjective && (
                                <div className="mt-2">
                                    <div className="d-grid">
                                        <button 
                                            className="btn btn-sm btn-outline-warning terminal-font text-uppercase"
                                            onClick={handleApplyImprovement}
                                            disabled={isLoading}
                                        >
                                            {isLoading ? 'OPTIMIZING...' : 'APPLY IMPROVEMENTS & REGENERATE'}
                                            <i className="bi bi-stars ms-2"></i>
                                        </button>
                                    </div>
                                    <small className="text-muted d-block mt-1 fst-italic" style={{fontSize: '0.75rem'}}>
                                        Proposed: "{analysis.refinedObjective}"
                                    </small>
                                </div>
                            )}
                        </div>

                        <div className="mb-3 p-3 border border-secondary border-opacity-25 rounded bg-dark bg-opacity-10">
                            <h6 className="terminal-font text-secondary mb-2 small text-uppercase fw-bold">
                                <i className="bi bi-shield-check me-2"></i>Validation Check (RU)
                            </h6>
                            <p className="analysis-text text-muted mb-0">{analysis.validationAnalysis}</p>
                        </div>

                        {analysis.suggestedOperators && analysis.suggestedOperators.length > 0 && (
                            <div>
                                <small className="text-muted d-block mb-2 text-uppercase small ls-1">Quick Add Vectors</small>
                                <div className="d-flex flex-wrap gap-2">
                                    {analysis.suggestedOperators.map((op, idx) => (
                                        <button 
                                            key={idx} 
                                            className="btn btn-sm btn-dark border border-secondary terminal-font text-light"
                                            onClick={() => setNaturalInput(prev => `${prev} + ${op}`)}
                                            title="Add this vector to objective"
                                        >
                                            <span className="text-success">+</span> {op}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                ) : !dork && (
                    <div className="text-center text-muted mt-5 opacity-25">
                        <div className="mb-3" style={{ fontSize: '2.5rem' }}><i className="bi bi-incognito"></i></div>
                        <p className="terminal-font small">AWAITING OBJECTIVE...</p>
                    </div>
                )}
             </div>
           </div>
        </div>
      </div>
      
      {/* History Log */}
      {history.length > 0 && (
        <div className="row mt-4">
            <div className="col-12">
                <div className="card shadow-sm">
                    <div className="card-header bg-transparent border-bottom border-secondary">
                        <h6 className="card-title mb-0 terminal-font text-muted text-uppercase small">
                            <i className="bi bi-clock-history me-2"></i>Mission History
                        </h6>
                    </div>
                    <div className="card-body p-0">
                        <div className="list-group list-group-flush">
                            {history.map((item, idx) => (
                                <button 
                                    key={item.timestamp}
                                    className="list-group-item list-group-item-action bg-transparent text-light border-secondary"
                                    onClick={() => {
                                        setNaturalInput(item.input);
                                        setDork(item.response.dork);
                                        setAnalysis(item.response);
                                        // Re-validate when loading from history
                                        setSyntaxErrors(validatePayload(item.response.dork));
                                    }}
                                >
                                    <div className="d-flex w-100 justify-content-between">
                                        <small className="terminal-font text-truncate" style={{maxWidth: '70%'}}>{item.input}</small>
                                        <small className="text-muted">{new Date(item.timestamp).toLocaleTimeString()}</small>
                                    </div>
                                    <small className="text-muted opacity-50 text-truncate d-block terminal-font">{item.response.dork}</small>
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
      )}
    </div>
  );
};

const root = createRoot(document.getElementById("root")!);
root.render(<App />);