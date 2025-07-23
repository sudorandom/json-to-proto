import { useState, useCallback } from 'react';
import { Light as SyntaxHighlighter } from 'react-syntax-highlighter';
import atelierSulphurpoolDark from 'react-syntax-highlighter/dist/esm/styles/hljs/atelier-sulphurpool-dark';
import jsonLang from 'react-syntax-highlighter/dist/esm/languages/hljs/json';
import protobufLang from 'react-syntax-highlighter/dist/esm/languages/hljs/protobuf';
SyntaxHighlighter.registerLanguage('json', jsonLang);
SyntaxHighlighter.registerLanguage('protobuf', protobufLang);
import { Play, Copy } from 'lucide-react';

// --- Helper Functions ---

/**
 * Converts a string to PascalCase.
 * e.g., "user_name" -> "UserName"
 */
const toPascalCase = (s: string): string => {
    if (!s) return '';
    return s
        .replace(/[^a-zA-Z0-9_ ]/g, '') // Sanitize
        .split(/[_\s]+/)
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join('');
};

/**
 * Converts a string to snake_case and ensures it's a valid proto field name.
 * e.g., "userName" -> "user_name"
 */
const toSnakeCase = (s: string): string => {
    if (!s) return '';
    const sanitized = s.replace(/[^a-zA-Z0-9]/g, '_');
    const snake = sanitized
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
        .replace(/([a-z\d])([A-Z])/g, '$1_$2')
        .toLowerCase();
    // Cannot start with a number
    if (snake.match(/^\d/)) {
        return `_${snake}`;
    }
    return snake;
};


// --- Core Conversion Logic ---

export class ProtoGenerator {
    // Removed duplicate imports property
    private messageCache: Map<string, string> = new Map();
    private float64WarningIssued: boolean = false;
    private warnings?: string[];

    // Avoid using parameter properties in constructor due to TS1294 error
    private config: { packageName?: string };
    constructor(config: { packageName?: string } = {}) {
        this.config = config;
    }

    /**
     * Recursively generates a message definition from a JSON object or merged field values.
     */
    private generateMessageDef(obj: Record<string, any>, messageName: string): string {
        let fieldIndex = 1;
        const fields: string[] = [];
        const nestedMessages: string[] = [];
        const seenFieldNames = new Set<string>();
        const fieldTypes: Record<string, Set<string>> = {};
        const fieldValues: Record<string, any[]> = {};

        // Collect all types for each field
        for (const key in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, key)) {
                const fieldName = toSnakeCase(key);
                if (!fieldTypes[fieldName]) fieldTypes[fieldName] = new Set();
                if (!fieldValues[fieldName]) fieldValues[fieldName] = [];

                const values = Array.isArray(obj[key]) ? obj[key] : [obj[key]];
                for (const value of values) {
                    let typeSig: string;
                    if (value === null) {
                        typeSig = 'null';
                    } else if (Array.isArray(value)) {
                        typeSig = 'array';
                    } else if (typeof value === 'number') {
                        typeSig = Number.isInteger(value) ? 'int64' : 'double';
                    } else {
                        typeSig = typeof value;
                    }
                    fieldTypes[fieldName].add(typeSig);
                    fieldValues[fieldName].push(value);
                }
            }
        }

        // Generate fields
        for (const fieldName of Object.keys(fieldTypes)) {
            if (seenFieldNames.has(fieldName)) continue;
            seenFieldNames.add(fieldName);

            const types = Array.from(fieldTypes[fieldName]);
            const values = fieldValues[fieldName];
            const nonNullValues = values.filter(v => v !== null);
            const isRepeated = nonNullValues.some(v => Array.isArray(v)) || values.length > 1;

            let finalType: string;

            if (types.every(t => t === 'null')) {
                this.imports.add('import "google/protobuf/struct.proto";');
                finalType = 'google.protobuf.NullValue';
            } else if (types.length > 1 && !(types.length === 2 && types.includes('int64') && types.includes('double'))) {
                this.imports.add('import "google/protobuf/struct.proto";');
                finalType = 'google.protobuf.Value';
            } else if (types.includes('double')) {
                finalType = 'double';
            } else {
                const value = nonNullValues.length > 0 ? nonNullValues[0] : values[0];
                finalType = this.getProtoType(value, fieldName, messageName, nestedMessages);
            }

            fields.push(`  ${isRepeated ? 'repeated ' : ''}${finalType} ${fieldName} = ${fieldIndex++};`);
        }

        let messageBody = `message ${messageName} {\n${fields.join('\n')}`;
        const uniqueNestedMessages = Array.from(new Set(nestedMessages));
        if (uniqueNestedMessages.length > 0) {
            messageBody += '\n\n' + uniqueNestedMessages.map(m => m.replace(/^/gm, '  ')).join('\n\n');
        }
        messageBody += '\n}';
        this.messageCache.set(messageName, messageBody);
        return messageBody;
    }

    private imports: Set<string> = new Set();

    /**
     * Determines the Protobuf type for a given JavaScript value.
     */
    private getProtoType(value: any, fieldName: string, parentMessageName: string, nestedMessages: string[]): string {
        switch (typeof value) {
            case 'string':
                return 'string';
            case 'number':
                if (!Number.isInteger(value) && !this.float64WarningIssued) {
                    this.warnings!.push('Warning: JSON number was mapped to float64 (double).');
                    this.float64WarningIssued = true;
                }
                return Number.isInteger(value) ? 'int64' : 'double';
            case 'boolean':
                return 'bool';
            case 'object':
                if (value === null) {
                    this.imports.add('import "google/protobuf/struct.proto";');
                    return 'google.protobuf.NullValue';
                }
                if (Array.isArray(value)) {
                    return this.getArrayType(value, fieldName, parentMessageName, nestedMessages);
                }
                const nestedMessageName = toPascalCase(fieldName);
                const nestedMessageDef = this.generateMessageDef(value, nestedMessageName);
                if (!nestedMessages.includes(nestedMessageDef)) {
                    nestedMessages.push(nestedMessageDef);
                }
                return nestedMessageName;
            default:
                this.imports.add('import "google/protobuf/any.proto";');
                return 'google.protobuf.Any';
        }
    }

    /**
     * Determines the type for an array, handling mixed types.
     */
    private getArrayType(arr: any[], fieldName: string, parentMessageName: string, nestedMessages: string[]): string {
        if (arr.length === 0) {
            this.imports.add('import "google/protobuf/any.proto";');
            return 'google.protobuf.Any';
        }

        const types = new Set<string>();
        const itemMessageDefs = new Set<string>();

        arr.forEach(item => {
            const singularFieldName = fieldName.endsWith('s') ? fieldName.slice(0, -1) : `${fieldName}_element`;
            if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
                const nestedMessageName = toPascalCase(singularFieldName);
                const nestedMessageDef = this.generateMessageDef(item, nestedMessageName);
                itemMessageDefs.add(nestedMessageDef);
                types.add(nestedMessageName);
            } else {
                types.add(this.getProtoType(item, singularFieldName, parentMessageName, nestedMessages));
            }
        });

        itemMessageDefs.forEach(def => {
            if (!nestedMessages.includes(def)) {
                nestedMessages.push(def);
            }
        });

        if (types.size === 1) {
            return types.values().next().value;
        }
        if (types.size === 2 && types.has('int64') && types.has('double')) {
            return 'double';
        }

        this.imports.add('import "google/protobuf/struct.proto";');
        return 'google.protobuf.Value';
    }

    public generate(jsonString: string, baseMessageName: string): { proto: string, warnings: string[] } {
        this.imports.clear();
        this.messageCache.clear();
        this.float64WarningIssued = false;
        this.warnings = [];
        let documents: any[] = [];

        let docStrings: string[] = [];
        docStrings = jsonString.split(/\n---+\n|\n{2,}/).map(s => s.trim()).filter(Boolean);
        if (docStrings.length === 1 && docStrings[0].match(/^\s*\{[\s\S]*\}\s*\n\s*\{[\s\S]*\}/)) {
            docStrings = jsonString.split(/(?<=\})\s*\n(?=\{)/).map(s => s.trim()).filter(Boolean);
        }

        for (const docStr of docStrings) {
            try {
                const parsed = JSON.parse(docStr);
                documents.push(parsed);
            } catch (e: any) {
                if (e instanceof SyntaxError && e.message.includes('circular')) {
                    return { proto: 'Error: Circular reference in JSON object.', warnings: [] };
                }
                return { proto: `Error: Invalid JSON - ${e.message}`, warnings: [] };
            }
        }
        if (documents.length === 0) {
            return { proto: "Error: No valid JSON documents found.", warnings: [] };
        }

        const root = documents.length === 1 ? documents[0] : documents;
        const packageName = this.config.packageName !== undefined
            ? this.config.packageName
            : (baseMessageName ? toSnakeCase(baseMessageName) : '');
        const rootMessageName = baseMessageName || 'RootMessage';

        const topMessage = this.generateMessageDef({ [rootMessageName]: root }, rootMessageName);

        const header = [
            'syntax = "proto3";',
            packageName ? `package ${packageName};` : '',
            ...Array.from(this.imports)
        ].filter(Boolean).join('\n');

        const protoText = `${header}\n\n${topMessage}`;

        return { proto: protoText, warnings: this.warnings! };
    }
}

export default function App() {
    const [jsonInput, setJsonInput] = useState(JSON.stringify({
        "user_id": 12345,
        "userName": "John Doe",
        "isActive": true,
        "courses": [
            { "courseId": "CS101", "courseName": "Intro to CS" },
            { "courseId": "MA203", "courseName": "Linear Algebra" }
        ],
        "metadata": null,
        "login_timestamps": [1679400000, 1679486400],
        "mixed_data": [1, "test", true, {"key": "value"}]
    }, null, 2));
    const [baseName, setBaseName] = useState('UserProfile');
    const [packageName, setPackageName] = useState('my_package');
    const [protoOutput, setProtoOutput] = useState('');
    const [warnings, setWarnings] = useState<string[]>([]);
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
                const generator = new ProtoGenerator({ packageName });
                const resultObj = generator.generate(jsonInput, baseName);
                if(resultObj.proto.startsWith('Error:')) {
                    setError(resultObj.proto);
                    setProtoOutput('');
                } else {
                    setProtoOutput(resultObj.proto);
                    setWarnings(resultObj.warnings);
                }
            } catch (e: any) {
                setError(`An unexpected error occurred: ${e.message}`);
                console.error(e);
            } finally {
                setIsLoading(false);
            }
        }, 500);
    }, [jsonInput, baseName, packageName]);

    const handleCopy = () => {
        if (!protoOutput) return;
        navigator.clipboard.writeText(protoOutput).then(() => {
            setCopySuccess(true);
            setTimeout(() => setCopySuccess(false), 2000);
        });
    };

    return (
        <div className="min-h-screen font-sans flex flex-col antialiased bg-gradient-to-br from-gray-950 via-gray-900 to-cyan-950">
            <header className="bg-gray-900/80 backdrop-blur border-b border-cyan-900 p-6 shadow-lg">
                <h1 className="text-4xl font-extrabold text-center text-cyan-400 drop-shadow-lg tracking-tight">JSON to Protobuf Converter</h1>
            </header>

            <main className="flex-grow flex flex-col lg:flex-row gap-4 sm:gap-8 p-4 sm:p-6 relative pb-40 sm:pb-56">
                {/* Input Panel */}
                <div className="flex flex-col bg-gradient-to-br from-gray-900 via-gray-800 to-cyan-950 rounded-2xl border border-cyan-900 shadow-2xl z-10 flex-1">
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
                    <div className="flex-grow flex flex-col overflow-hidden">
                        <label htmlFor="jsonInput" className="block text-base font-semibold text-cyan-300 px-4 sm:px-6 pt-4 sm:pt-6 pb-2 tracking-wide">
                            JSON Input
                        </label>
                         <div className="flex-grow rounded-b-2xl overflow-hidden border-t border-cyan-900 flex flex-col">
                            <textarea
                                id="jsonInput"
                                value={jsonInput}
                                onChange={e => setJsonInput(e.target.value)}
                                className="w-full flex-grow bg-gray-950 text-cyan-100 border border-cyan-700 rounded-lg p-3 sm:p-4 font-mono text-base focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 outline-none transition placeholder:text-gray-500 resize-none min-h-[220px] sm:min-h-[150px]"
                                placeholder="Paste or type your JSON here..."
                                spellCheck={false}
                                style={{
                                    fontSize: '1rem',
                                    borderRadius: '0.75rem',
                                    padding: '0.75rem',
                                    background: 'transparent',
                                }}
                            />
                        </div>
                    </div>
                </div>

                {/* Center Control: below input on mobile, between panels on desktop */}
                <div className="flex justify-center items-center py-6 lg:py-0 lg:flex-col lg:justify-center lg:items-center" style={{minWidth: '220px'}}>
                    <button
                        onClick={handleConvert}
                        disabled={isLoading}
                        className="w-full lg:w-auto bg-cyan-500 hover:bg-cyan-600 text-white font-bold py-3 sm:py-4 px-6 sm:px-8 rounded-full transition-all duration-300 ease-in-out transform hover:scale-105 disabled:bg-gray-600 disabled:cursor-not-allowed flex items-center gap-3 shadow-xl text-lg tracking-wide"
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
                <div className="flex flex-col bg-gradient-to-br from-gray-900 via-gray-800 to-cyan-950 rounded-2xl border border-cyan-900 shadow-2xl z-10 flex-1">
                    <div className="p-4 sm:p-6 border-b border-cyan-900 flex flex-col sm:flex-row justify-between items-center gap-2">
                        <h2 className="text-2xl font-bold text-cyan-300 tracking-wide">Protobuf Output</h2>
                        <button
                            onClick={handleCopy}
                            disabled={!protoOutput}
                            className="w-full sm:w-auto bg-cyan-700 hover:bg-cyan-600 text-white font-semibold py-2 px-4 rounded-lg text-base disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition shadow-md"
                        >
                           <Copy size={18} />
                           {copySuccess ? 'Copied!' : 'Copy'}
                        </button>
                    </div>
                    <div className="flex-grow rounded-b-2xl overflow-hidden border-t border-cyan-900 flex flex-col">
                        {warnings.length > 0 && (
                            <div className="bg-yellow-900/40 text-yellow-200 p-4 text-base font-mono border-b border-yellow-700">
                                {warnings.map((w, i) => (
                                    <div key={i}>{w}</div>
                                ))}
                            </div>
                        )}
                        <SyntaxHighlighter
                            language="protobuf"
                            style={atelierSulphurpoolDark}
                            customStyle={{
                                background: 'transparent',
                                fontSize: '1rem',
                                borderRadius: '0.75rem',
                                padding: '0.75rem',
                                minHeight: '150px',
                            }}
                            showLineNumbers
                        >
                            {error ? error : (protoOutput || "// Your generated .proto file will appear here")}
                        </SyntaxHighlighter>
                    </div>
                </div>
            </main>
            <footer className="text-center py-4 sm:py-6 text-gray-500 text-sm bg-gray-900/80 border-t border-cyan-900 mt-8">
                <section className="max-w-3xl mx-auto text-left p-6 bg-gray-800 rounded-lg shadow-lg border border-cyan-800">
                    <h2 className="text-2xl font-bold mb-4 text-cyan-300">How This Works &amp; Important Caveats</h2>
                    <p className="mb-4">
                        <strong>json-to-proto</strong> converts JSON objects into Protocol Buffers (<strong>protobuf</strong>) message definitions. It analyzes your JSON, infers types, and generates a <code>.proto</code> schema for serialization and communication.
                    </p>
                    <h3 className="text-xl font-semibold mt-6 mb-2 text-cyan-200">How It Works</h3>
                    <ul className="list-disc ml-6 mb-4">
                        <li>Parses your JSON and walks through its structure.</li>
                        <li>Infers protobuf types for each field (e.g., <code>string</code>, <code>int32</code>, <code>bool</code>, <code>repeated</code>, <code>message</code>).</li>
                        <li>Nested objects become nested messages; arrays become repeated fields.</li>
                        <li>Outputs a <code>.proto</code> file reflecting your JSON structure.</li>
                    </ul>
                    <h3 className="text-xl font-semibold mt-6 mb-2 text-cyan-200">Flaws &amp; Limitations</h3>
                    <ol className="list-decimal ml-6 mb-4 space-y-2">
                        <li>
                            <strong>Dynamic Keys / JSON Maps:</strong> Does not reliably detect when an object should be a protobuf <code>map</code> (dynamic keys).
                            <br />
                            <span className="italic">Example:</span> <code>{'{ "user123": { ... }, "user456": { ... } }'}</code> should be <code>map&lt;string, User&gt;</code>, but may generate fixed fields instead.
                        </li>
                        <li>
                            <strong>Type Inference:</strong> Will default to <code>google.protobuf.Value</code> for mixed-type fields (e.g., sometimes string, sometimes number), which can represent any JSON type.
                        </li>
                        <li>
                            <strong>Enum Detection:</strong> Does not auto-detect enums. Fixed string sets are generated as <code>string</code> fields.
                        </li>
                        <li>
                            <strong>Field Numbering:</strong> Field numbers are assigned sequentially and may change across runs.
                        </li>
                        <li>
                            <strong>JSON Number Types:</strong> Only <code>int64</code> is supported for numbers. All JSON numbers will be mapped to <code>int64</code>, which may not match the original type exactly.
                        </li>
                    </ol>
                    <h3 className="text-xl font-semibold mt-6 mb-2 text-cyan-200">Examples</h3>
                    <div className="mb-4">
                        <div className="mb-2 font-mono text-cyan-100">Simple Object</div>
                        <pre className="bg-gray-900 p-3 rounded text-sm overflow-x-auto mb-2">{`Input: {"id": 1, "name": "Alice"}
Output:
message Root {
  int32 id = 1;
  string name = 2;
}`}</pre>
                    </div>
                    <div className="mb-4">
                        <div className="mb-2 font-mono text-cyan-100">Nested Object</div>
                        <pre className="bg-gray-900 p-3 rounded text-sm overflow-x-auto mb-2">{`Input: {"user": { "id": 1, "name": "Bob" }}
Output:
message User {
  int32 id = 1;
  string name = 2;
}
message Root {
  User user = 1;
}`}</pre>
                    </div>
                    <div className="mb-4">
                        <div className="mb-2 font-mono text-cyan-100">Array of Objects</div>
                        <pre className="bg-gray-900 p-3 rounded text-sm overflow-x-auto mb-2">{`Input: {"users": [ { "id": 1 }, { "id": 2 } ]}
Output:
message User {
  int32 id = 1;
}
message Root {
  repeated User users = 1;
}`}</pre>
                    </div>
                    <div className="mb-4">
                        <div className="mb-2 font-mono text-cyan-100">Dynamic Keys (Map)</div>
                        <pre className="bg-gray-900 p-3 rounded text-sm overflow-x-auto mb-2">{`Input: {"users": { "alice": { "id": 1 }, "bob": { "id": 2 } }}
Ideal Output:
message User {
  int32 id = 1;
}
message Root {
  map<string, User> users = 1;
}
Actual Output:
message User {
  int32 id = 1;
}
message Users {
  User alice = 1;
  User bob = 2;
}
message Root {
  Users users = 1;
}
Caveat: You must manually convert to a map if needed.`}</pre>
                    </div>
                    <div className="mb-4">
                        <div className="mb-2 font-mono text-cyan-100">Mixed-Type Array (Unsupported)</div>
                        <pre className="bg-gray-900 p-3 rounded text-sm overflow-x-auto mb-2">{`Input: {"values": [1, "two", true]}
Output: Error or incorrect type.
Caveat: Normalize your array to a single type before conversion.`}</pre>
                    </div>
                    <h3 className="text-xl font-semibold mt-6 mb-2 text-cyan-200">Summary</h3>
                    <ul className="list-disc ml-6 mb-2">
                        <li>Great for quickly generating <code>.proto</code> files from well-structured, predictable JSON.</li>
                        <li>Manual review and editing is recommended for complex or dynamic data.</li>
                        <li>Be aware of the above limitations and adjust your workflow as needed.</li>
                    </ul>
                </section>
            </footer>
        </div>
    );
}
