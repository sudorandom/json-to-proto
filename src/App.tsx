import { useState, useCallback } from 'react';
import { Light as SyntaxHighlighter } from 'react-syntax-highlighter';
import atelierSulphurpoolDark from 'react-syntax-highlighter/dist/esm/styles/hljs/atelier-sulphurpool-dark';
import jsonLang from 'react-syntax-highlighter/dist/esm/languages/hljs/json';
import protobufLang from 'react-syntax-highlighter/dist/esm/languages/hljs/protobuf';
SyntaxHighlighter.registerLanguage('json', jsonLang);
SyntaxHighlighter.registerLanguage('protobuf', protobufLang);
import { Play, Copy } from 'lucide-react';
// ...existing code...

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

class ProtoGenerator {
    private messages: Map<string, string> = new Map();
    private imports: Set<string> = new Set();

    /**
     * Determines the Protobuf type for a given JavaScript value.
     */
    private getProtoType(value: any, fieldName: string, parentMessageName: string): string {
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
                    return this.getArrayType(value, fieldName, parentMessageName);
                }
                // It's an object, so it will be a nested message.
                const nestedMessageName = toPascalCase(`${parentMessageName}_${fieldName}`);
                this.generateMessageDef(value, nestedMessageName);
                return nestedMessageName;
            default:
                this.imports.add('import "google/protobuf/any.proto";');
                return 'google.protobuf.Any';
        }
    }

    /**
     * Determines the type for an array, handling mixed types.
     */
    private getArrayType(arr: any[], fieldName: string, parentMessageName: string): string {
        if (arr.length === 0) {
            this.imports.add('import "google/protobuf/any.proto";');
            return 'repeated google.protobuf.Any';
        }

        const types = new Set<string>();
        arr.forEach(item => {
            // Pass a generic name for elements since they don't have one.
            const singularFieldName = fieldName.endsWith('s') ? fieldName.slice(0, -1) : `${fieldName}_element`;
            types.add(this.getProtoType(item, singularFieldName, parentMessageName));
        });

        if (types.size === 1) {
            const singleType = types.values().next().value;
            return `repeated ${singleType}`;
        } else {
            // Mixed types in array
            this.imports.add('import "google/protobuf/struct.proto";');
            return 'repeated google.protobuf.Value';
        }
    }

    /**
     * Recursively generates a message definition from a JSON object.
     */
    private generateMessageDef(obj: Record<string, any>, messageName: string): void {
        if (this.messages.has(messageName)) {
            return; // Already generated
        }

        let fieldIndex = 1;
        const fields: string[] = [];
        const seenFieldNames = new Set<string>();

        for (const key in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, key)) {
                const fieldName = toSnakeCase(key);
                if(seenFieldNames.has(fieldName)) continue;
                seenFieldNames.add(fieldName);

                const value = obj[key];
                const protoType = this.getProtoType(value, key, messageName);
                fields.push(`  ${protoType} ${fieldName} = ${fieldIndex++};`);
            }
        }

        const messageBody = `message ${messageName} {\n${fields.join('\n')}\n}`;
        this.messages.set(messageName, messageBody);
    }

    /**
     * Main function to generate the full .proto file content.
     */
    public generate(jsonString: string, baseMessageName: string): string {
        this.messages.clear();
        this.imports.clear();
        let data: Record<string, any>;

        try {
            data = JSON.parse(jsonString);
            if (typeof data !== 'object' || data === null || Array.isArray(data)) {
                 return "Error: Root of JSON must be an object.";
            }
        } catch (e: any) {
            return `Error: Invalid JSON - ${e.message}`;
        }

        const rootMessageName = toPascalCase(baseMessageName) || 'RootMessage';
        this.generateMessageDef(data, rootMessageName);

        const sortedMessages = Array.from(this.messages.values());

        const header = [
            'syntax = "proto3";',
            baseMessageName ? `package ${toSnakeCase(baseMessageName)};` : '',
            ...Array.from(this.imports)
        ].filter(Boolean).join('\n');

        return `${header}\n\n${sortedMessages.join('\n\n')}`;
    }
}


// --- React Component ---

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

        // Simulate processing time for better UX
        setTimeout(() => {
            try {
                const generator = new ProtoGenerator();
                const result = generator.generate(jsonInput, baseName);
                if(result.startsWith('Error:')) {
                    setError(result);
                    setProtoOutput('');
                } else {
                    setProtoOutput(result);
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
                    <div className="flex-grow rounded-b-2xl overflow-hidden border-t border-cyan-900">
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
