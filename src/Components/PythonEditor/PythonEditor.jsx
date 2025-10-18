import React, { useState, useEffect, useRef } from 'react';
import Editor from '@monaco-editor/react';
import './PythonEditor.css';
import { loadPyodide } from 'pyodide';

let editorInstance = null;
let pyodideInstance = null;

export default function PythonEditor({ sharedState, updateSharedState }) {
  const [isRunning, setIsRunning] = useState(false);
  const [isPyodideReady, setIsPyodideReady] = useState(false);
  const [changedLines, setChangedLines] = useState([]);
  const [userInput, setUserInput] = useState('');

  // Initialize Pyodide
  useEffect(() => {
    const initPyodide = async () => {
      try {
        updateSharedState({ output: "> Initializing Python environment..." });
        
        pyodideInstance = await loadPyodide({
          indexURL: `https://cdn.jsdelivr.net/pyodide/v0.27.7/full/`,
          checkAPIVersion: true,
        });

        // Set up proper stdout/stderr handling
        pyodideInstance.runPython(`
import sys
from io import StringIO

class OutputCapture:
    def __init__(self):
        self.output = []
    
    def write(self, text):
        if text.strip():
            self.output.append(text.rstrip())
    
    def flush(self):
        pass
    
    def get_output(self):
        return '\\n'.join(self.output)

# Create output capture instances
stdout_capture = OutputCapture()
stderr_capture = OutputCapture()

# Redirect stdout and stderr
sys.stdout = stdout_capture
sys.stderr = stderr_capture
        `);

        setIsPyodideReady(true);
        updateSharedState({ output: "> Python environment ready!" });
      } catch (error) {
        console.error('Failed to initialize Pyodide:', error);
        updateSharedState({ output: `> Error: Failed to initialize Python environment` });
      }
    };

    initPyodide();
  }, []);

  useEffect(() => {
    if (editorInstance && changedLines.length > 0) {
      // Create decorations for changed lines
      const decorations = changedLines.map(line => ({
        range: {
          startLineNumber: line,
          startColumn: 1,
          endLineNumber: line,
          endColumn: 1
        },
        options: {
          isWholeLine: true,
          className: 'highlight-line',
          stickiness: 1
        }
      }));

      const decorationIds = editorInstance.deltaDecorations([], decorations);

      const timer = setTimeout(() => {
        editorInstance.deltaDecorations(decorationIds, []);
        setChangedLines([]);
      }, 2000);

      return () => clearTimeout(timer);
    }
  }, [changedLines]);

  const handleEditorDidMount = (editor) => {
    editorInstance = editor;
  };

  const handleRunCode = async () => {
    if (!isPyodideReady) {
      updateSharedState({ output: "> Error: Python environment not ready yet" });
      return;
    }

    setIsRunning(true);
    updateSharedState({ output: "> Running Python code..." });

    try {
      const code = sharedState.code;
      
      if (!code || code.trim() === '') {
        updateSharedState({ output: "> No code to execute" });
        setIsRunning(false);
        return;
      }

      // Clear previous output
      pyodideInstance.runPython(`
stdout_capture.output.clear()
stderr_capture.output.clear()
      `);

      // Handle user input if provided
      if (userInput) {
        pyodideInstance.runPython(`
import sys
from io import StringIO

class InputWrapper:
    def __init__(self, input_text):
        self.input_text = input_text.split('\\n')
        self.position = 0
    
    def readline(self):
        if self.position < len(self.input_text):
            result = self.input_text[self.position] + '\\n'
            self.position += 1
            return result
        return ''

# Replace stdin with our input wrapper
sys.stdin = InputWrapper('${userInput.replace(/'/g, "\\'")}')
        `);
      } else {
        // Disable input() function if no user input provided
        pyodideInstance.runPython(`
import sys
from io import StringIO

class NoInputWrapper:
    def readline(self):
        raise OSError("Input not available - please provide input in the input field")

sys.stdin = NoInputWrapper()
        `);
      }

      // Execute the Python code
      const result = pyodideInstance.runPython(code);
      
      // Get captured output
      const stdoutOutput = pyodideInstance.runPython('stdout_capture.get_output()');
      const stderrOutput = pyodideInstance.runPython('stderr_capture.get_output()');
      
      // Display the result
      let output = "";
      if (stdoutOutput) {
        output += stdoutOutput;
      }
      if (stderrOutput) {
        output += (output ? "\n" : "") + stderrOutput;
      }
      if (result !== undefined && result !== null && result !== "") {
        output += (output ? "\n" : "") + String(result);
      }
      
      updateSharedState({ 
        output: output || "> Program executed (no output)" 
      });

    } catch (error) {
      console.error('Python execution error:', error);
      updateSharedState({ 
        output: `> Error: ${error.message || "Python execution failed"}` 
      });
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="editor-container">
      <div className="editor-section">
        <Editor
          height="100%"
          language="python"
          theme="vs-dark"
          value={sharedState.code}
          onChange={(value) => updateSharedState({ code: value || '' })}
          onMount={handleEditorDidMount}
          options={{
            minimap: { enabled: false },
            fontSize: 14,
            wordWrap: 'on',
            lineNumbers: 'on',
            scrollBeyondLastLine: false,
            padding: { top: 20 },
            renderLineHighlight: 'none',
            lineDecorationsWidth: 10,
            glyphMargin: false,
            lineNumbersMinChars: 3,
            folding: false,
            autoClosingBrackets: 'always',
            formatOnType: true,
            suggestOnTriggerCharacters: true,
            tabSize: 4,
            insertSpaces: true
          }}
        />
      </div>

      <div className="input-field-container">
        <input
          type="text"
          value={userInput}
          onChange={(e) => setUserInput(e.target.value)}
          placeholder="Enter input for your program..."
          className="program-input"
        />
      </div>

      <div className="output-section">
        <div className="output-header">
          <h3 className='output-title'>Output</h3>
          <div className="status-indicator">
            <button 
              className="run-button"
              onClick={handleRunCode}
              disabled={isRunning || !isPyodideReady}
            >
              {isRunning ? 'Running...' : 'Run'}
            </button>
          </div>
        </div>
        <pre className="output-content">
          {sharedState.output}
        </pre>
      </div>
    </div>
  );
}