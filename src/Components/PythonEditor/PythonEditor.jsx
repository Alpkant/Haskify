import React, { useState } from 'react';
import Editor from '@monaco-editor/react';
import './PythonEditor.css';
import { usePython } from 'react-py';

let editorInstance = null;

// Add console output capture
let consoleOutput = [];

const stdout = (msg) => {
  consoleOutput.push(String(msg));
  console.log(msg);
};

export default function PythonEditor({ sharedState, updateSharedState }) {
  const {
    runPython,
    stdout,
    stderr,
    isLoading,
    isRunning,
    interruptExecution,
    // Add these:
    readFile,
    writeFile,
    mkdir,
    packages
  } = usePython();

  const [userInput, setUserInput] = useState('');

  const handleRunCode = async () => {
    const code = sharedState.code;
    
    if (!code || code.trim() === '') {
      updateSharedState({ output: "> No code to execute" });
      return;
    }

    // Inject inputs if provided
    const inputs = userInput.split('\n').filter(line => line !== '');
    let finalCode = code;
    
    if (inputs.length > 0) {
      // Prepend input setup
      finalCode = `
import sys
from io import StringIO
sys.stdin = StringIO(${JSON.stringify(inputs.join('\n') + '\n')})

${code}
      `;
    }

    // Run the code
    const result = await runPython(finalCode);
    
    // Display output
    const output = stdout || stderr || String(result) || "> Program executed (no output)";
    updateSharedState({ output });

    // Log to backend (existing logic)
    // ... your logging code ...
  };

  const handleEditorDidMount = (editor) => {
    editorInstance = editor;
  };

  const handleInputKeyPress = (e) => {
    if (e.key === 'Enter') {
      handleRunCode();
    }
  };

  // Install packages dynamically
  const installPackage = async (packageName) => {
    await packages.install(packageName);
  };

  const handleStop = () => {
    interruptExecution();
    updateSharedState({ output: "> Execution interrupted" });
  };

  // Write uploaded Python files to virtual filesystem
  const handleFileUpload = async (file) => {
    const content = await file.text();
    await writeFile(file.name, content);
    updateSharedState({ output: `> Uploaded ${file.name}` });
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
          placeholder="Enter inputs (one per line)..."
          className="program-input"
        />
      </div>

      <div className="output-section">
        <button 
          onClick={handleRunCode}
          disabled={isRunning || isLoading}
        >
          {isRunning ? 'Running...' : isLoading ? 'Loading...' : 'Run'}
        </button>
        <pre>{sharedState.output}</pre>
      </div>
    </div>
  );
}