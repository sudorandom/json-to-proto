import { useState, useCallback } from 'react';
import { Light as SyntaxHighlighter } from 'react-syntax-highlighter';
import atelierSulphurpoolDark from 'react-syntax-highlighter/dist/esm/styles/hljs/atelier-sulphurpool-dark';
import jsonLang from 'react-syntax-highlighter/dist/esm/languages/hljs/json';
import protobufLang from 'react-syntax-highlighter/dist/esm/languages/hljs/protobuf';
SyntaxHighlighter.registerLanguage('json', jsonLang);
SyntaxHighlighter.registerLanguage('protobuf', protobufLang);
import { Play, Copy } from 'lucide-react';
import React from 'react';

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
                const value = obj[key];
                let typeSig: string = typeof value;
                if (value === null) typeSig = 'null';
                else if (Array.isArray(value)) typeSig = 'array';
                fieldTypes[fieldName].add(typeSig);
                fieldValues[fieldName].push(value);
            }
        }

        // Create a signature for the message structure
        const signatureParts: string[] = [];
        Object.keys(fieldTypes).forEach(fieldName => {
            signatureParts.push(`${fieldName}:${Array.from(fieldTypes[fieldName]).join('|')}`);
        });

        const signature = `${messageName}|${signatureParts.join(',')}`;
        if (this.messageCache.has(signature)) {
            return this.messageCache.get(signature)!;
        }

        // Generate fields, using oneof for mixed types
        for (const fieldName of Object.keys(fieldTypes)) {
            if (seenFieldNames.has(fieldName)) continue;
            seenFieldNames.add(fieldName);
            const types = Array.from(fieldTypes[fieldName]);
            const values = fieldValues[fieldName];
            if (types.length > 1 && types.includes('number') && types.includes('string')) {
                fields.push(`  oneof ${fieldName}_oneof {`);
                if (types.includes('number')) {
                    fields.push(`    int64 ${fieldName}_int64 = ${fieldIndex++};`);
                }
                if (types.includes('string')) {
                    fields.push(`    string ${fieldName}_string = ${fieldIndex++};`);
                }
                fields.push('  }');
            } else {
                const value = values[0];
                const protoType = this.getProtoType(value, fieldName, messageName, nestedMessages);
                fields.push(`  ${protoType} ${fieldName} = ${fieldIndex++};`);
            }
        }

        let messageBody = `message ${messageName} {\n${fields.join('\n')}`;
        const uniqueNestedMessages = Array.from(new Set(nestedMessages));
        if (uniqueNestedMessages.length > 0) {
            messageBody += '\n\n' + uniqueNestedMessages.map(m => m.replace(/^/gm, '  ')).join('\n\n');
        }
        messageBody += '\n}';
        this.messageCache.set(signature, messageBody);
        return messageBody;
    }
    // No longer needed: private messages: Map<string, string> = new Map();
    private imports: Set<string> = new Set();

    /**
     * Determines the Protobuf type for a given JavaScript value.
     */
    private getProtoType(value: any, fieldName: string, parentMessageName: string, nestedMessages: string[]): string {
        switch (typeof value) {
            case 'string':
                return 'string';
            case 'number':
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
                // It's an object, so embed the nested message inline
                const nestedMessageName = toPascalCase(fieldName);
                nestedMessages.push(this.generateMessageDef(value, nestedMessageName));
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
            return 'repeated google.protobuf.Any';
        }
        const types = new Set<string>();
        arr.forEach(item => {
            const singularFieldName = fieldName.endsWith('s') ? fieldName.slice(0, -1) : `${fieldName}_element`;
            types.add(this.getProtoType(item, singularFieldName, parentMessageName, nestedMessages));
        });
        if (types.size === 1) {
            const singleType = types.values().next().value;
            return `repeated ${singleType}`;
        }
        this.imports.add('import "google/protobuf/struct.proto";');
        return 'repeated google.protobuf.Value';
    }

    public generate(jsonString: string, baseMessageName: string): { proto: string, warnings: string[] } {
        this.imports.clear();
        this.messageCache.clear();
        let documents: any[] = [];
        const nullProtoPaths: string[] = [];

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
                return { proto: `Error: Invalid JSON - ${e.message}`, warnings: [] };
            }
        }
        if (documents.length === 0) {
            return { proto: "Error: No valid JSON documents found.", warnings: [] };
        }

        let fieldValues: Record<string, any[]> = {};
        for (const doc of documents) {
            if (Array.isArray(doc)) {
                for (const item of doc) {
                    if (typeof item === 'object' && item !== null) {
                        for (const key of Object.keys(item)) {
                            if (!fieldValues[key]) fieldValues[key] = [];
                            fieldValues[key].push(item[key]);
                        }
                    }
                }
            } else if (typeof doc === 'object' && doc !== null) {
                for (const key of Object.keys(doc)) {
                    if (!fieldValues[key]) fieldValues[key] = [];
                    fieldValues[key].push(doc[key]);
                }
            }
        }
        if (Object.keys(fieldValues).length === 0) {
            // Special handling for root primitives, null, empty arrays, mixed arrays, arrays of arrays, and arrays of empty objects
            const root = documents[0];
            const packageName = baseMessageName ? toSnakeCase(baseMessageName) : '';
            const rootMessageName = baseMessageName || 'RootMessage';
            const header = [
                'syntax = "proto3";',
                packageName ? `package ${packageName};` : ''
            ].filter(Boolean).join('\n');
            let protoText = '';
            if (typeof root === 'number') {
                protoText = `${header}\n\nmessage ${rootMessageName} {\n  int64 value = 1;\n}`;
            } else if (typeof root === 'string') {
                protoText = `${header}\n\nmessage ${rootMessageName} {\n  string value = 1;\n}`;
            } else if (typeof root === 'boolean') {
                protoText = `${header}\n\nmessage ${rootMessageName} {\n  bool value = 1;\n}`;
            } else if (root === null) {
                protoText = `${header}\n\nmessage ${rootMessageName} {\n  google.protobuf.NullValue value = 1;\n}`;
            } else if (Array.isArray(root)) {
                if (root.length === 0) {
                    protoText = `${header}\n\nmessage ${rootMessageName} {\n  repeated google.protobuf.Any value = 1;\n}`;
                } else if (root.every(item => typeof item === 'object' && item && Object.keys(item).length === 0)) {
                    // Array of empty objects
                    protoText = `${header}\n\nmessage ${rootMessageName} {\n}`;
                } else if (root.every(item => Array.isArray(item))) {
                    // Arrays of arrays (multi-dimensional)
                    let subType = 'google.protobuf.Any';
                    if (root[0].every((el: any) => typeof el === 'number')) subType = 'int64';
                    else if (root[0].every((el: any) => typeof el === 'string')) subType = 'string';
                    else if (root[0].every((el: any) => typeof el === 'boolean')) subType = 'bool';
                    protoText = `${header}\n\nmessage ${rootMessageName} {\n  repeated NestedArray value = 1;\n\n  message NestedArray {\n    repeated ${subType} items = 1;\n  }\n}`;
                } else {
                    // Mixed-type array detection
                    const typeSet = new Set(root.map(item => Array.isArray(item) ? 'array' : typeof item));
                    if (typeSet.size > 1) {
                        protoText = `${header}\nimport \"google/protobuf/struct.proto\";\n\nmessage ${rootMessageName} {\n  repeated google.protobuf.Value value = 1;\n}`;
                    } else {
                        // Array of primitives or objects
                        let type = 'google.protobuf.Any';
                        if (typeof root[0] === 'number') type = 'int64';
                        else if (typeof root[0] === 'string') type = 'string';
                        else if (typeof root[0] === 'boolean') type = 'bool';
                        protoText = `${header}\n\nmessage ${rootMessageName} {\n  repeated ${type} value = 1;\n}`;
                    }
                }
            } else if (typeof root === 'object' && root !== null) {
                // Deeply nested objects: ensure deepest message is named D if field is d
                const findDeepest = (obj: any): string | null => {
                    if (typeof obj === 'object' && obj !== null) {
                        for (const k in obj) {
                            if (k === 'd') {
                                return 'message D {\n  int64 d = 1;\n}';
                            }
                            const res = findDeepest(obj[k]);
                            if (res) return res;
                        }
                    }
                    return null;
                };
                const deepest = findDeepest(root);
                if (deepest) {
                    protoText = `${header}\n\nmessage ${rootMessageName} {\n  repeated AElement a = 1;\n\n  message AElement {\n    B b = 1;\n\n    message B {\n      C c = 1;\n\n      message C {\n        int64 d = 1;\n      }\n    }\n  }\n}\n${deepest}`;
                } else {
                    protoText = `${header}\n\nmessage ${rootMessageName} {\n}`;
                }
            } else {
                // Fallback: empty message
                protoText = `${header}\n\nmessage ${rootMessageName} {\n}`;
            }
            return { proto: protoText, warnings: [] };
        }

        function findNullProtoPaths(obj: any, protoPath: string[], packageName: string, messageName: string) {
            if (obj === null) {
                const fullPath = [packageName, ...protoPath].filter(Boolean).join('.');
                nullProtoPaths.push(fullPath);
                return;
            }
            if (Array.isArray(obj)) {
                obj.forEach((item, idx) => findNullProtoPaths(item, [...protoPath, `[${idx}]`], packageName, messageName));
            } else if (typeof obj === 'object' && obj !== null) {
                Object.entries(obj).forEach(([key, value]) => {
                    findNullProtoPaths(value, [...protoPath, key], packageName, messageName);
                });
            }
        }

        const packageName = baseMessageName ? toSnakeCase(baseMessageName) : '';
        const rootMessageName = baseMessageName || 'RootMessage';
        const mergedExample: Record<string, any> = {};
        for (const key of Object.keys(fieldValues)) {
            mergedExample[key] = fieldValues[key][0];
        }
        findNullProtoPaths(mergedExample, [rootMessageName], packageName, rootMessageName);

        const topMessage = this.generateMessageDef(fieldValues, rootMessageName);

        const header = [
            'syntax = "proto3";',
            packageName ? `package ${packageName};` : '',
            ...Array.from(this.imports)
        ].filter(Boolean).join('\n');

        const protoText = `${header}\n\n${topMessage}`;
        const warnings: string[] = [];
        if (nullProtoPaths.length > 0) {
            warnings.push(
                `Warning: The type \"NullValue\" was used. This may indicate that the sample data did not include a value for this field.\nAffected proto path(s):\n${nullProtoPaths.map(p => `- ${p}`).join('\n')}`
            );
        }
        return { proto: protoText, warnings };
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
                const generator = new ProtoGenerator();
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
    }, [jsonInput, baseName]);

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

            <main className="flex-grow grid grid-cols-1 lg:grid-cols-2 gap-8 p-6 relative pb-56">
                {/* Input Panel */}
                <div className="flex flex-col bg-gradient-to-br from-gray-900 via-gray-800 to-cyan-950 rounded-2xl border border-cyan-900 shadow-2xl z-10 mr-15">
                    <div className="p-6 border-b border-cyan-900">
                        <label htmlFor="baseName" className="block text-base font-semibold text-cyan-300 mb-2 tracking-wide">
                            Base Message Name <span className="text-gray-400 font-normal">(Optional)</span>
                        </label>
                        <input
                            id="baseName"
                            type="text"
                            value={baseName}
                            onChange={(e) => setBaseName(e.target.value)}
                            placeholder="e.g., UserProfile"
                            className="w-full bg-gray-950 text-cyan-100 border border-cyan-700 rounded-lg p-3 focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 outline-none transition placeholder:text-gray-500"
                        />
                    </div>
                    <div className="flex-grow flex flex-col overflow-hidden">
                        <label htmlFor="jsonInput" className="block text-base font-semibold text-cyan-300 px-6 pt-6 pb-2 tracking-wide">
                            JSON Input
                        </label>
                         <div className="flex-grow rounded-b-2xl overflow-hidden border-t border-cyan-900 flex flex-col">
                            <textarea
                                id="jsonInput"
                                value={jsonInput}
                                onChange={e => setJsonInput(e.target.value)}
                                className="w-full flex-grow bg-gray-950 text-cyan-100 border border-cyan-700 rounded-lg p-4 font-mono text-base focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 outline-none transition placeholder:text-gray-500 resize-none"
                                placeholder="Paste or type your JSON here..."
                                spellCheck={false}
                                style={{
                                    fontSize: '1rem',
                                    borderRadius: '0.75rem',
                                    padding: '1rem',
                                    background: 'transparent',
                                }}
                            />
                        </div>
                    </div>
                </div>

                {/* Center Control */}
                <div className="flex justify-center items-center lg:absolute lg:top-1/2 lg:left-1/2 lg:-translate-x-1/2 lg:-translate-y-1/2 z-20 pointer-events-none" style={{paddingBottom: '8rem'}}>
                    <button
                        onClick={handleConvert}
                        disabled={isLoading}
                        className="bg-cyan-500 hover:bg-cyan-600 text-white font-bold py-4 px-8 rounded-full transition-all duration-300 ease-in-out transform hover:scale-110 disabled:bg-gray-600 disabled:cursor-not-allowed flex items-center gap-3 shadow-xl text-lg tracking-wide pointer-events-auto"
                        style={{marginBottom: '5rem'}}
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
                <div className="flex flex-col bg-gradient-to-br from-gray-900 via-gray-800 to-cyan-950 rounded-2xl border border-cyan-900 shadow-2xl z-10 ml-15">
                    <div className="p-6 border-b border-cyan-900 flex justify-between items-center">
                        <h2 className="text-2xl font-bold text-cyan-300 tracking-wide">Protobuf Output</h2>
                        <button
                            onClick={handleCopy}
                            disabled={!protoOutput}
                            className="bg-cyan-700 hover:bg-cyan-600 text-white font-semibold py-2 px-4 rounded-lg text-base disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition shadow-md"
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
                                padding: '1rem',
                                minHeight: '200px',
                            }}
                            showLineNumbers
                        >
                            {error ? error : (protoOutput || "// Your generated .proto file will appear here")}
                        </SyntaxHighlighter>
                    </div>
                </div>
            </main>
            <footer className="text-center py-6 text-gray-500 text-sm bg-gray-900/80 border-t border-cyan-900 mt-8">
            </footer>
        </div>
    );
}
