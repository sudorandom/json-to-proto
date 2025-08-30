import { useState, useCallback } from 'react';
import { Light as SyntaxHighlighter } from 'react-syntax-highlighter';
import atelierSulphurpoolDark from 'react-syntax-highlighter/dist/esm/styles/hljs/atelier-sulphurpool-dark';
import jsonLang from 'react-syntax-highlighter/dist/esm/languages/hljs/json';
import protobufLang from 'react-syntax-highlighter/dist/esm/languages/hljs/protobuf';
SyntaxHighlighter.registerLanguage('json', jsonLang);
SyntaxHighlighter.registerLanguage('protobuf', protobufLang);
import { Play, Copy } from 'lucide-react';
import { generateDescriptorFromJson, generateProto } from './protoDescriptorGenerator';
import type { Task } from './tasks';


export default function App() {
    const [jsonInput, setJsonInput] = useState(JSON.stringify({
        "user_id": 12345,
        "userName": "John Doe",
        "isActive": true,
        "courses": [
            { "courseId": "CS101", "courseName": "Intro to CS" },
            { "courseId": "MA203", "courseName": "Linear Algebra", "credits": null }
        ],
        "metadata": null,
        "login_timestamps": [1679400000, 1679486400],
        "mixed_data": [1, "test", true, {"key": "value"}, null]
    }, null, 2));
    const [baseName, setBaseName] = useState('UserProfile');
    const [packageName, setPackageName] = useState('my_package');
    const [protoOutput, setProtoOutput] = useState('');
    const [descriptor, setDescriptor] = useState<any>(null);
    const [warnings, setWarnings] = useState<string[]>([]);
    const [mapHints] = useState<{ [msg: string]: string[] }>({});
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');
    const [copySuccess, setCopySuccess] = useState(false);


    const handleConvert = useCallback(() => {
        if (!jsonInput.trim()) {
            setError('JSON input cannot be empty.');
            return;
        }
        setIsLoading(true);
        setError('');
        setProtoOutput('');
        setWarnings([]);

        setTimeout(() => {
            try {
                let parsed: any;
                try {
                    parsed = JSON.parse(jsonInput);
                } catch (e: any) {
                    setError('Error: Invalid JSON - ' + e.message);
                    setIsLoading(false);
                    return;
                }
                const desc = generateDescriptorFromJson(parsed, { packageName, messageName: baseName, mapHints });
                setDescriptor(desc);
                const proto = generateProto(desc);
                setProtoOutput(proto);
                setWarnings([]); // Optionally, add warnings if your descriptor logic provides them
            } catch (e: any) {
                setError(`An unexpected error occurred: ${e.message}`);
                console.error(e);
            } finally {
                setIsLoading(false);
            }
        }, 500);
    }, [jsonInput, baseName, packageName, mapHints]);

    // --- Place getMapTasks immediately before return so it's in scope for JSX ---
    function getMapTasks() {
        if (!descriptor) return [];
        const tasks: Task[] = [];
        const rootMsgName = baseName;
        const pkg = descriptor.lookup ? descriptor.lookup(packageName) : null;
        if (!pkg || !pkg.nestedArray) return tasks;

        // Collect all message types (excluding root)
        const messageTypes = pkg.nestedArray.filter(
            (n: any) => n instanceof Object && n.name !== rootMsgName && n.fieldsArray
        );

        // For each message type, find all fields in all messages that reference it
        for (const msgType of messageTypes) {
            for (const parentMsg of pkg.nestedArray) {
                if (!parentMsg.fieldsArray) continue;
                for (const field of parentMsg.fieldsArray) {
                    // If the field type matches this message type
                    if (field.type === msgType.name) {
                        // Refinement tasks are disabled
                    }
                }
            }
        }
        return tasks;
    }

    const handleCopy = () => {
        if (!protoOutput) return;
        const textArea = document.createElement('textarea');
        textArea.value = protoOutput;
        document.body.appendChild(textArea);
        textArea.select();
        try {
            document.execCommand('copy');
            setCopySuccess(true);
            setTimeout(() => setCopySuccess(false), 2000);
        } catch (err: any) {
            console.error('Failed to copy text: ', err);
        }
        document.body.removeChild(textArea);
    };

    return (
        <div className="min-h-screen font-sans flex flex-col antialiased bg-gradient-to-br from-gray-950 via-gray-900 to-cyan-950 text-gray-200">
            <header className="bg-gray-900/80 backdrop-blur border-b border-cyan-900 p-6 shadow-lg">
                <h1 className="text-4xl font-extrabold text-center text-cyan-400 drop-shadow-lg tracking-tight">JSON to Protobuf Converter</h1>
            </header>

            <main className="flex-grow flex flex-col lg:flex-row gap-4 sm:gap-8 p-4 sm:p-6 relative">
                {/* Input Panel */}
                <div className="flex flex-col bg-gradient-to-br from-gray-900/90 via-gray-800/90 to-cyan-950/90 rounded-2xl border border-cyan-900 shadow-2xl z-10 flex-1 min-w-0">
                    <div className="p-4 sm:p-6 border-b border-cyan-900">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
                            <div className="flex flex-col gap-2">
                                <label htmlFor="packageName" className="text-base font-semibold text-cyan-300 tracking-wide whitespace-nowrap">
                                    Package Name:
                                </label>
                                <input
                                    id="packageName"
                                    type="text"
                                    value={packageName}
                                    onChange={(e) => setPackageName(e.target.value)}
                                    placeholder="e.g., my_package"
                                    className="bg-gray-950 text-cyan-100 border border-cyan-700 rounded-lg p-2 focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 outline-none transition placeholder:text-gray-500 w-full"
                                />
                            </div>
                            <div className="flex flex-col gap-2">
                                <label htmlFor="baseName" className="text-base font-semibold text-cyan-300 tracking-wide whitespace-nowrap">
                                    Base Message Name:
                                </label>
                                <input
                                    id="baseName"
                                    type="text"
                                    value={baseName}
                                    onChange={(e) => setBaseName(e.target.value)}
                                    placeholder="e.g., UserProfile"
                                    className="bg-gray-950 text-cyan-100 border border-cyan-700 rounded-lg p-2 focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 outline-none transition placeholder:text-gray-500 w-full"
                                />
                            </div>
                        </div>
                    </div>
                    <div className="flex-grow flex flex-col overflow-hidden p-4 sm:p-6 pt-2 sm:pt-4">
                        <label htmlFor="jsonInput" className="block text-base font-semibold text-cyan-300 pb-2 tracking-wide">
                            JSON Input
                        </label>
                         <div className="flex-grow rounded-xl overflow-hidden border border-cyan-800 flex flex-col min-h-[400px] lg:min-h-[400px]">
                            <textarea
                                id="jsonInput"
                                value={jsonInput}
                                onChange={e => setJsonInput(e.target.value)}
                                className="w-full h-full flex-grow bg-gray-950/70 text-cyan-100 p-3 sm:p-4 font-mono text-sm focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 outline-none transition placeholder:text-gray-500 resize-none"
                                placeholder="Paste or type your JSON here..."
                                spellCheck={false}
                            />
                        </div>
                    </div>
                </div>

                {/* Center Control */}
                <div className="flex justify-center items-center py-4 lg:py-0 lg:flex-col lg:justify-center lg:items-center" style={{minWidth: '180px'}}>
                    <button
                        onClick={handleConvert}
                        disabled={isLoading}
                        className="w-full lg:w-auto bg-cyan-500 hover:bg-cyan-600 text-white font-bold py-3 sm:py-4 px-6 sm:px-8 rounded-full transition-all duration-300 ease-in-out transform hover:scale-105 disabled:bg-gray-600 disabled:cursor-not-allowed flex items-center justify-center gap-3 shadow-xl text-lg tracking-wide"
                    >
                        {isLoading ? (
                            <div className="animate-spin rounded-full h-6 w-6 border-t-2 border-b-2 border-white"></div>
                        ) : (
                            <Play size={24} />
                        )}
                        <span>{isLoading ? 'Converting...' : 'Convert'}</span>
                    </button>
                </div>

                {/* Output Panel */}
                <div className="flex flex-col bg-gradient-to-br from-gray-900/90 via-gray-800/90 to-cyan-950/90 rounded-2xl border border-cyan-900 shadow-2xl z-10 flex-1 min-w-0">
                    <div className="p-4 sm:p-6 border-b border-cyan-900 flex flex-col sm:flex-row justify-between items-center gap-2">
                        <h2 className="text-2xl font-bold text-cyan-300 tracking-wide">Protobuf Output</h2>
                        <button
                            onClick={handleCopy}
                            disabled={!protoOutput || !!error}
                            className="w-full sm:w-auto bg-cyan-700 hover:bg-cyan-600 text-white font-semibold py-2 px-4 rounded-lg text-base disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition shadow-md"
                        >
                           <Copy size={18} />
                           {copySuccess ? 'Copied!' : 'Copy'}
                        </button>
                    </div>
                    <div className="flex-grow rounded-b-2xl overflow-hidden flex flex-col min-h-[400px] lg:min-h-0">
                        {warnings.length > 0 && (
                            <div className="bg-yellow-900/40 text-yellow-200 p-3 text-sm font-mono border-b border-yellow-700">
                                {warnings.map((w, i) => (
                                    <div
                                        key={i}
                                        className="mb-3 last:mb-0 pb-3 last:pb-0 border-b border-yellow-700 last:border-b-0"
                                        style={{
                                            marginBottom: i === warnings.length - 1 ? 0 : '0.75rem',
                                            paddingBottom: i === warnings.length - 1 ? 0 : '0.75rem',
                                            borderBottom: i === warnings.length - 1 ? 'none' : '1px solid #b45309'
                                        }}
                                    >
                                        {w}
                                    </div>
                                ))}
                            </div>
                        )}
                        <div className="flex-grow overflow-auto bg-gray-950/70 rounded-b-xl border-t border-cyan-800">
                            <SyntaxHighlighter
                                language="protobuf"
                                style={atelierSulphurpoolDark}
                                customStyle={{
                                    background: 'transparent',
                                    fontSize: '0.875rem',
                                    padding: '1rem',
                                    margin: 0,
                                    width: '100%',
                                    height: '100%',
                                }}
                                codeTagProps={{
                                    style: {
                                        fontFamily: "monospace"
                                    }
                                }}
                                showLineNumbers
                            >
                                {error ? error : (protoOutput || "// Your generated .proto file will appear here")}
                            </SyntaxHighlighter>
                        </div>
                        {/* Refinement Tasks below the protobuf output */}
                        {descriptor && getMapTasks().length > 0 && (
                            <div className="p-4 border-t border-cyan-900 flex flex-wrap gap-2 bg-gray-950/60">
                                <span className="text-cyan-300 font-semibold mr-2">Refinement Tasks:</span>
                                {getMapTasks().map((task, idx) => (
                                    <button
                                        key={idx}
                                        onClick={() => task.run()}
                                        className="bg-cyan-800 hover:bg-cyan-600 text-white font-semibold py-1 px-3 rounded-lg text-sm transition shadow-md"
                                    >
                                        {task.label}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </main>

            <footer className="container mx-auto p-6 sm:p-10 text-gray-400">
                <div className="max-w-5xl mx-auto">
                    <div className="bg-yellow-900/30 text-yellow-300 p-4 rounded-lg border border-yellow-700/50 mb-10 text-center">
                        <p className="font-bold text-lg mb-2 text-yellow-200">Disclaimer</p>
                        <p className="text-yellow-400">
                            This tool provides a best-effort conversion and should be used as a starting point.
                            The generated Protobuf schema is based on inference and may require manual adjustments and validation to perfectly match your data model's requirements and edge cases. Always review the output carefully and remember that this is primarily a learning tool.
                        </p>
                    </div>

                    <h2 className="text-3xl font-bold text-center text-cyan-400 mb-8 tracking-tight">How It Works: JSON to Protobuf Conversion</h2>

                    <div className="space-y-10 bg-gray-900/50 p-6 sm:p-8 rounded-xl border border-cyan-900/50">

                        <section>
                            <h3 className="text-2xl font-semibold text-cyan-300 mb-4 border-b border-cyan-800 pb-2">General Approach</h3>
                            <p className="mb-4">
                                This converter takes your JSON data and intelligently infers a Protobuf schema. It analyzes the fields, their data types, and their structure across one or more JSON documents. The core logic involves:
                            </p>
                            <ul className="list-disc list-inside space-y-2 pl-4">
                                <li>
                                    <strong>Parsing & Aggregation:</strong> It first parses the input string into JSON objects. If multiple documents are provided (e.g., separated by newlines), it aggregates all of them to build a complete picture of the data structure.
                                </li>
                                <li>
                                    <strong>Field Merging:</strong> For arrays of objects or multiple root-level objects, it merges fields. If a field appears in one object but not another, it's treated as an optional field in the resulting Protobuf message.
                                </li>
                                <li>
                                    <strong>Type Inference:</strong> It determines the most appropriate Protobuf type for each field based on the values seen in the JSON data.
                                </li>
                                <li>
                                    <strong>Recursive Message Generation:</strong> For nested JSON objects, it recursively generates corresponding nested Protobuf <code>message</code> definitions.
                                </li>
                                <li>
                                    <strong>Style Conversion:</strong> Field names are automatically converted to <code>snake_case</code> to adhere to the official Protobuf style guide.
                                </li>
                            </ul>
                        </section>

                        <section>
                            <h3 className="text-2xl font-semibold text-cyan-300 mb-4 border-b border-cyan-800 pb-2">Type Mapping</h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="bg-gray-800/40 p-4 rounded-lg border border-cyan-800/50">
                                    <h4 className="font-bold text-cyan-200">JSON String</h4>
                                    <p>Mapped to <a href="https://protobuf.dev/programming-guides/proto3/#scalar" target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:underline"><code>string</code></a>.</p>
                                </div>
                                <div className="bg-gray-800/40 p-4 rounded-lg border border-cyan-800/50">
                                    <h4 className="font-bold text-cyan-200">JSON Number</h4>
                                    <p>Mapped to <a href="https://protobuf.dev/programming-guides/proto3/#scalar" target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:underline"><code>int64</code></a> for integers and <a href="https://protobuf.dev/programming-guides/proto3/#scalar" target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:underline"><code>double</code></a> for floats. Using <code>int64</code> and <code>float64</code> ensures large numbers are handled safely.</p>
                                </div>
                                <div className="bg-gray-800/40 p-4 rounded-lg border border-cyan-800/50">
                                    <h4 className="font-bold text-cyan-200">JSON Boolean</h4>
                                    <p>Mapped to <a href="https://protobuf.dev/programming-guides/proto3/#scalar" target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:underline"><code>bool</code></a>.</p>
                                </div>
                                <div className="bg-gray-800/40 p-4 rounded-lg border border-cyan-800/50">
                                    <h4 className="font-bold text-cyan-200">JSON Object</h4>
                                    <p>Mapped to a new nested <a href="https://protobuf.dev/programming-guides/proto3/#message" target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:underline"><code>message</code></a> type. The message name is derived from the object's field name.</p>
                                </div>
                                <div className="bg-gray-800/40 p-4 rounded-lg border border-cyan-800/50 col-span-1 md:col-span-2">
                                    <h4 className="font-bold text-cyan-200">JSON Array</h4>
                                    <p>Mapped to a <a href="https://protobuf.dev/programming-guides/proto3/#specifying-field-rules" target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:underline"><code>repeated</code></a> field. The type of the repeated field is inferred from the elements within the array. See Edge Cases for details on mixed-type or empty arrays.</p>
                                </div>
                            </div>
                        </section>

                        <section>
                            <h3 className="text-2xl font-semibold text-cyan-300 mb-4 border-b border-cyan-800 pb-2">Edge Cases & Special Handling</h3>
                            <ul className="list-disc list-inside space-y-4 pl-4">
                                <li>
                                    <strong>JSON <code>null</code> Values:</strong> In Protobuf, there is no direct equivalent to JSON's <code>null</code>. When a field has a <code>null</code> value, it is treated as if the field is not present. This means the corresponding field in the Protobuf message will be optional and will simply not be set.
                                </li>
                                <li>
                                    <strong>Mixed-Type Arrays:</strong> Protobuf arrays (repeated fields) must contain elements of a single type. If an array with mixed types (e.g., <code>[1, "hello", true]</code>) is detected, the converter uses the special <a href="https://protobuf.dev/reference/protobuf/google.protobuf/#value" target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:underline"><code>google.protobuf.Value</code></a> type. This requires adding <code>import "google/protobuf/struct.proto";</code> to your <code>.proto</code> file.
                                </li>
                                <li>
                                    <strong>Empty Arrays:</strong> If an array is empty (<code>[]</code>), its type cannot be inferred. The converter will default to <code>repeated google.protobuf.Value</code> as a safe fallback, allowing any valid JSON value to be added to the list later.
                                </li>
                                <li>
                                    <strong>Empty Objects:</strong> An empty JSON object (<code>{`{}`}</code>) will be mapped to an empty message definition.
                                </li>
                                <li>
                                    <strong>JSON Objects vs. Protobuf Maps:</strong> A JSON object can represent either a structured entity with a fixed set of fields (e.g., <code>{`{"name": "test", "id": 1}`}</code>) or a dictionary with arbitrary keys (e.g., <code>{`{"feature_a": true, "feature_b": false}`}</code>). This converter defaults to inferring a new Protobuf <code>message</code> for every JSON object, as it is the safest and most common representation. A <a href="https://protobuf.dev/programming-guides/proto3/#maps" target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:underline"><code>map&lt;key_type, value_type&gt;</code></a> may be more appropriate if your object's keys are arbitrary and all its values share the same data type. Manual refactoring of the generated schema might be needed for these cases.
                                </li>
                            </ul>
                        </section>

                    </div>
                </div>
            </footer>
        </div>
    );
}
