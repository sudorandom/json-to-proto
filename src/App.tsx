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
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
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
    private messageCache: Map<string, string> = new Map();
    private warnings: string[] = [];
    private imports: Set<string> = new Set();
    private config: { packageName?: string };

    constructor(config: { packageName?: string } = {}) {
        this.config = config;
    }

    private getTypeName(value: any): string {
        if (value === null) return 'null'; // Internal representation
        if (Array.isArray(value)) return 'array';
        if (typeof value === 'number') {
            if (!Number.isInteger(value)) {
                this.warnings.push('Warning: JSON number was mapped to float64 (double).');
            }
            return Number.isInteger(value) ? 'int64' : 'double';
        }
        if (typeof value === 'boolean') return 'bool';
        return typeof value;
    }

    private mergeAll(objects: any[]): any {
        if (objects.length === 0) return {};
        if (objects.length === 1) {
            if (typeof objects[0] !== 'object' || objects[0] === null || Array.isArray(objects[0])) {
                return { 'value': objects[0] };
            }
            return objects[0];
        }

        const result: Record<string, any> = {};
        const allKeys = new Set(objects.flatMap(o => (typeof o === 'object' && o !== null) ? Object.keys(o) : []));
        const areOriginalObjectsArrays = objects.every(o => Array.isArray(o));

        for (const key of allKeys) {
            const valuesForKey: any[] = [];
            for (const obj of objects) {
                if (typeof obj === 'object' && obj !== null && Object.prototype.hasOwnProperty.call(obj, key)) {
                    valuesForKey.push(obj[key]);
                }
            }

            if (valuesForKey.length === 0) continue;

            const allObjects = valuesForKey.every(v => typeof v === 'object' && v !== null && !Array.isArray(v));
            const allArrays = valuesForKey.every(v => Array.isArray(v));
            const allPrimitives = valuesForKey.every(v => typeof v !== 'object' || v === null);

            if (allObjects) {
                result[key] = this.mergeAll(valuesForKey);
            } else if (allArrays) {
                const mergedArrayElements = valuesForKey.flat();
                if (mergedArrayElements.length > 0) {
                    const allElementsAreObjects = mergedArrayElements.every(item => typeof item === 'object' && item !== null && !Array.isArray(item));
                    if (allElementsAreObjects) {
                        result[key] = [this.mergeAll(mergedArrayElements)];
                    } else {
                        result[key] = mergedArrayElements;
                    }
                } else {
                    result[key] = [];
                }
            } else if (allPrimitives) {
                const nonNullValues = valuesForKey.filter(v => v !== null);

                if (nonNullValues.length === 0) {
                    this.imports.add('import "google/protobuf/struct.proto";');
                    result[key] = 'google.protobuf.Value';
                } else {
                    const types = new Set(nonNullValues.map(v => this.getTypeName(v)));
                    if (types.size === 1) {
                        // If merging an array of arrays, the result is a repeated field.
                        // If merging an array of objects, the result is a singular field.
                        if (areOriginalObjectsArrays) {
                            result[key] = nonNullValues;
                        } else {
                            result[key] = nonNullValues[0];
                        }
                    } else {
                        this.imports.add('import "google/protobuf/struct.proto";');
                        result[key] = 'google.protobuf.Value';
                    }
                }
            } else {
                this.imports.add('import "google/protobuf/struct.proto";');
                result[key] = 'google.protobuf.Value';
            }
        }
        return result;
    }

    private generateMessageDef(obj: Record<string, any>, messageName: string): string {
        const signature = `${messageName}|${JSON.stringify(Object.keys(obj).sort())}`;
        if (this.messageCache.has(signature)) {
            return this.messageCache.get(signature)!;
        }

        const fields: string[] = [];
        const nestedMessages: string[] = [];
        let fieldIndex = 1;

        for (const key in obj) {
            if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;

            const fieldName = toSnakeCase(key);
            const value = obj[key];
            const isRepeated = Array.isArray(value);
            
            let protoType: string;

            if (isRepeated) {
                const nonNullElements = value.filter((v: any) => v !== null);
                if (nonNullElements.length === 0) {
                    this.imports.add('import "google/protobuf/struct.proto";');
                    protoType = 'google.protobuf.Value';
                } else {
                    const elementTypes = new Set(nonNullElements.map((v: any) => this.getTypeName(v)));
                    const containsObjects = nonNullElements.some((v: any) => typeof v === 'object' && !Array.isArray(v));

                    if (elementTypes.size > 1 || (containsObjects && elementTypes.size > 1)) {
                         this.imports.add('import "google/protobuf/struct.proto";');
                         protoType = 'google.protobuf.Value';
                    } else if (containsObjects) {
                         const nestedMessageName = toPascalCase(key);
                         const mergedObject = this.mergeAll(nonNullElements);
                         nestedMessages.push(this.generateMessageDef(mergedObject, nestedMessageName));
                         protoType = nestedMessageName;
                    } else {
                         protoType = this.getTypeName(nonNullElements[0]);
                    }
                }
            } else {
                 const actualValue = value;
                 if (actualValue === 'google.protobuf.Value') {
                    this.imports.add('import "google/protobuf/struct.proto";');
                    protoType = 'google.protobuf.Value';
                } else if (actualValue === null) {
                    this.imports.add('import "google/protobuf/struct.proto";');
                    protoType = 'google.protobuf.Value';
                } else if (typeof actualValue === 'object' && !Array.isArray(actualValue)) {
                    const nestedMessageName = toPascalCase(key);
                    nestedMessages.push(this.generateMessageDef(actualValue, nestedMessageName));
                    protoType = nestedMessageName;
                } else {
                    protoType = this.getTypeName(actualValue);
                }
            }

            fields.push(`  ${isRepeated ? 'repeated ' : ''}${protoType} ${fieldName} = ${fieldIndex++};`);
        }

        let messageBody = `message ${messageName} {\n${fields.join('\n')}`;
        const uniqueNestedMessages = Array.from(new Set(nestedMessages));
        if (uniqueNestedMessages.length > 0) {
            messageBody += '\n\n' + uniqueNestedMessages.map(m => m.replace(/^/gm, '  ')).join('\n\n');
        }
        messageBody += `\n}`;
        this.messageCache.set(signature, messageBody);
        return messageBody;
    }

    public generate(jsonString: string, baseMessageName: string): { proto: string, warnings: string[] } {
        this.imports.clear();
        this.messageCache.clear();
        this.warnings = [];

        let documents: any[] = [];
        const cleanedJsonString = jsonString.trim();

        let parsedJson;
        try {
            parsedJson = JSON.parse(cleanedJsonString);
        } catch (e) {
            const docStrings = cleanedJsonString.split(/\n---+\n|\n{2,}|(?<=\})\s*\n(?={)/).map(s => s.trim()).filter(Boolean);
            if (docStrings.length > 0) {
                try {
                    documents = docStrings.map(s => JSON.parse(s));
                } catch (e2: any) {
                    return { proto: `Error: Invalid JSON - ${e2.message}`, warnings: [] };
                }
            } else {
                 if (cleanedJsonString) {
                    return { proto: `Error: Invalid JSON - ${e.message}`, warnings: [] };
                 }
            }
        }

        if (parsedJson !== undefined) {
             documents = Array.isArray(parsedJson) ? parsedJson : [parsedJson];
        }

        const rootMessageName = toPascalCase(baseMessageName) || 'RootMessage';
        const packageName = this.config.packageName || toSnakeCase(baseMessageName);
        
        if (Array.isArray(parsedJson) && documents.length === 0) {
            this.imports.add('import "google/protobuf/any.proto";');
            const topMessage = `message ${rootMessageName} {\n  repeated google.protobuf.Any value = 1;\n}`;
             const header = [
                'syntax = "proto3";',
                packageName ? `package ${packageName};` : '',
                ...Array.from(this.imports)
            ].filter(Boolean).join('\n');
            return { proto: `${header}\n\n${topMessage}`, warnings: this.warnings };
        }


        if (documents.length === 0) {
            return { proto: 'Error: No valid JSON documents found.', warnings: [] };
        }

        let merged: any;
        let topMessage: string;
        
        const root = documents[0];
        if (documents.length === 1 && (typeof root !== 'object' || root === null || (typeof root === 'object' && Object.keys(root).length === 0))) {
            if (typeof root === 'number') {
                topMessage = `message ${rootMessageName} {\n  ${this.getTypeName(root)} value = 1;\n}`;
            } else if (typeof root === 'string') {
                topMessage = `message ${rootMessageName} {\n  string value = 1;\n}`;
            } else if (typeof root === 'boolean') {
                topMessage = `message ${rootMessageName} {\n  bool value = 1;\n}`;
            } else if (root === null) {
                this.imports.add('import "google/protobuf/struct.proto";');
                topMessage = `message ${rootMessageName} {\n  google.protobuf.Value value = 1;\n}`;
            } else if (typeof root === 'object' && root !== null && Object.keys(root).length === 0) {
                topMessage = `message ${rootMessageName} {\n}`;
            } else {
                 return { proto: `Error: Unsupported root JSON type: ${typeof root}`, warnings: [] };
            }
        } else {
            merged = this.mergeAll(documents);
            topMessage = this.generateMessageDef(merged, rootMessageName);
        }
        
        const header = [
            'syntax = "proto3";',
            packageName ? `package ${packageName};` : '',
            ...Array.from(this.imports)
        ].filter(Boolean).join('\n');

        return { proto: `${header}\n\n${topMessage}`, warnings: this.warnings };
    }
}

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
        const textArea = document.createElement('textarea');
        textArea.value = protoOutput;
        document.body.appendChild(textArea);
        textArea.select();
        try {
            document.execCommand('copy');
            setCopySuccess(true);
            setTimeout(() => setCopySuccess(false), 2000);
        } catch (err) {
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
                         <div className="flex-grow rounded-xl overflow-hidden border border-cyan-800 flex flex-col min-h-[250px] lg:min-h-0">
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
                    <div className="flex-grow rounded-b-2xl overflow-hidden flex flex-col min-h-[250px] lg:min-h-0">
                        {warnings.length > 0 && (
                            <div className="bg-yellow-900/40 text-yellow-200 p-3 text-sm font-mono border-b border-yellow-700">
                                {warnings.map((w, i) => (
                                    <div key={i}>{w}</div>
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
                    </div>
                </div>
            </main>
        </div>
    );
}
