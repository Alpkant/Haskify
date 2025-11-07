import React, { useState, useEffect } from 'react';
import AceEditor from 'react-ace';
import { usePython } from 'react-py';
import './PythonEditor.css';

// Import Ace Editor themes and modes
import 'ace-builds/src-noconflict/mode-python';
import 'ace-builds/src-noconflict/theme-monokai';
import 'ace-builds/src-noconflict/ext-language_tools';

// Add this to suppress warnings:
import ace from 'ace-builds/src-noconflict/ace';
ace.config.set('basePath', '/node_modules/ace-builds/src-noconflict');

export default function PythonEditor({ sharedState, updateSharedState }) {
  // Debug: Check SharedArrayBuffer
  useEffect(() => {
    console.log('🔍 SharedArrayBuffer available:', typeof SharedArrayBuffer !== 'undefined');
    console.log('🔍 crossOriginIsolated:', window.crossOriginIsolated);
  }, []);

  const {
    runPython,
    stdout,
    stderr,
    isLoading,
    isRunning,
    interruptExecution,
    isAwaitingInput,
    sendInput,
    prompt
  } = usePython();

  const [showOutput, setShowOutput] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const inputRef = React.useRef(null);

  // Auto-focus input when awaiting
  useEffect(() => {
    if (isAwaitingInput && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isAwaitingInput]);

  // Update output whenever stdout/stderr changes
  useEffect(() => {
    if (stdout || stderr) {
      let output = "";
      if (stdout) output += stdout;
      if (stderr) {
        if (output) output += '\n';
        output += stderr;
      }
      updateSharedState({ output });
    }
  }, [stdout, stderr]);

  const handleRunCode = () => {
    const code = sharedState.code;
    
    if (!code || code.trim() === '') {
      updateSharedState({ output: "> No code to execute" });
      return;
    }

    updateSharedState({ output: "> Running Python code..." });
    runPython(code);  // Just run it - react-py handles input() blocking
    setShowOutput(true);
  };

  const handleStop = () => {
    interruptExecution();
    setShowOutput(false);
    updateSharedState({ output: "> Execution interrupted" });
  };

  const handleInputSubmit = (e) => {
    if (e) e.preventDefault();
    sendInput(inputValue);
    setInputValue('');
    
    // Log after a delay to capture final output
    setTimeout(async () => {
      const finalOutput = stdout || stderr || "> Program executed (no output)";
      await logToBackend(sharedState.code, finalOutput);
    }, 500);
  };

  const logToBackend = async (code, output) => {
    try {
      const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:5001";
      const savedUser = localStorage.getItem('haskify_user');
      const userId = savedUser ? JSON.parse(savedUser).userId : null;
      
      const savedSessionId = sessionStorage.getItem('haskify_session');
      
      const response = await fetch(`${API_BASE}/api/log/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId, 
          sessionId: savedSessionId,
          code: code,
          output: output
        })
      });

      if (response.ok) {
        const logResult = await response.json();
        
        if (logResult.sessionId && !savedSessionId) {
          sessionStorage.setItem('haskify_session', logResult.sessionId);
          console.log('✓ [PythonEditor] Created new session:', logResult.sessionId.substring(0, 8) + '...');
        }
      }
    } catch (logErr) {
      console.error('❌ Code execution log failed:', logErr);
    }
  };

  return (
    <div className="editor-container">
      <div className="editor-section">
        <AceEditor
          mode="python"
          theme="monokai"
          value={sharedState.code}
          onChange={(value) => updateSharedState({ code: value || '' })}
          name="python-editor"
          width="100%"
          height="100%"
          fontSize={14}
          showPrintMargin={false}
          showGutter={true}
          highlightActiveLine={true}
          readOnly={isRunning}
          setOptions={{
            enableBasicAutocompletion: true,
            enableLiveAutocompletion: true,
            enableSnippets: true,
            showLineNumbers: true,
            highlightActiveLine: true,
            tabSize: 4,
            useWorker: false
          }}
          editorProps={{ $blockScrolling: true }}
        />
      </div>

      {/* Inline input field (matches official react-py pattern) */}
      {(
        <div className="input-inline-container">
          <label className="input-inline-label">
            Input
          </label>
          <div className="input-inline-wrapper">
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleInputSubmit()}
              placeholder={prompt || 'Enter value...'}
              className="input-inline-field"
            />
            <button
              type="button"
              className="input-inline-button"
              onClick={handleInputSubmit}
            >
              Submit
            </button>
          </div>
        </div>
      )}

      <div className="output-section">
        <div className="output-header">
          <h3 className='output-title'>Output</h3>
          <div className="status-indicator">
            {isAwaitingInput && (
              <span className="awaiting-input-badge">
                ⏳ Waiting for input...
              </span>
            )}
            {isRunning && (
              <button 
                className="stop-button"
                onClick={handleStop}
                title="Stop execution"
              >
                Stop
              </button>
            )}
            <button 
              className="run-button"
              onClick={handleRunCode}
              disabled={isRunning || isLoading}
            >
              {isRunning ? 'Running...' : isLoading ? 'Loading Python...' : 'Run'}
            </button>
          </div>
        </div>
        {showOutput && (
          <pre className="output-content">
            {sharedState.output}
          </pre>
        )}
      </div>
    </div>
  );
}