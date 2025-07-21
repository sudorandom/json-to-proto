import { useState, useCallback } from 'react';
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
        <div className="bg-gray-900 text-white min-h-screen font-sans flex flex-col antialiased">
            <header className="bg-gray-800/70 backdrop-blur-sm border-b border-gray-700 p-4 sticky top-0 z-10">
                <h1 className="text-2xl font-bold text-center text-cyan-400">JSON to Protobuf Converter</h1>
                <p className="text-center text-gray-400 mt-1">Client-side conversion using TypeScript.</p>
            </header>

            <main className="flex-grow grid grid-cols-1 lg:grid-cols-11 gap-4 p-4">
                {/* Input Panel */}
                <div className="lg:col-span-5 flex flex-col bg-gray-800 rounded-lg border border-gray-700 shadow-2xl">
                    <div className="p-4 border-b border-gray-700">
                        <label htmlFor="baseName" className="block text-sm font-medium text-gray-300 mb-2">
                            Base Message Name (Optional)
                        </label>
                        <input
                            id="baseName"
                            type="text"
                            value={baseName}
                            onChange={(e) => setBaseName(e.target.value)}
                            placeholder="e.g., UserProfile"
                            className="w-full bg-gray-900 text-white border border-gray-600 rounded-md p-2 focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 outline-none transition"
                        />
                    </div>
                    <div className="flex-grow flex flex-col">
                         <label htmlFor="jsonInput" className="block text-sm font-medium text-gray-300 p-4 pb-2">
                            JSON Input
                        </label>
                        <textarea
                            id="jsonInput"
                            value={jsonInput}
                            onChange={(e) => setJsonInput(e.target.value)}
                            className="flex-grow bg-gray-800 text-white p-4 rounded-b-lg focus:outline-none resize-none font-mono text-sm"
                            placeholder='{ "key": "value" }'
                            spellCheck="false"
                        />
                    </div>
                </div>

                {/* Center Control */}
                <div className="flex justify-center items-center lg:col-span-1">
                    <button
                        onClick={handleConvert}
                        disabled={isLoading}
                        className="bg-cyan-500 hover:bg-cyan-600 text-white font-bold py-3 px-6 rounded-full transition-all duration-300 ease-in-out transform hover:scale-105 disabled:bg-gray-600 disabled:cursor-not-allowed flex items-center gap-2 shadow-lg"
                    >
                        {isLoading ? (
                            <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-white"></div>
                        ) : (
                            <Play size={20} />
                        )}
                        <span>{isLoading ? 'Converting...' : 'Convert'}</span>
                    </button>
                </div>

                {/* Output Panel */}
                <div className="lg:col-span-5 flex flex-col bg-gray-800 rounded-lg border border-gray-700 shadow-2xl">
                    <div className="p-4 border-b border-gray-700 flex justify-between items-center">
                        <h2 className="text-lg font-semibold text-gray-300">Protobuf Output</h2>
                        <button
                            onClick={handleCopy}
                            disabled={!protoOutput}
                            className="bg-gray-700 hover:bg-gray-600 text-white font-semibold py-1 px-3 rounded-md text-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition"
                        >
                           <Copy size={16} />
                           {copySuccess ? 'Copied!' : 'Copy'}
                        </button>
                    </div>
                    <div className="flex-grow bg-gray-900 rounded-b-lg p-4 font-mono text-sm">
                        {error && <div className="text-red-400 bg-red-900/50 p-3 rounded-md mb-4 whitespace-pre-wrap">{error}</div>}
                        <pre className="whitespace-pre-wrap break-all h-full overflow-auto">
                            <code>{protoOutput || "// Your generated .proto file will appear here"}</code>
                        </pre>
                    </div>
                </div>
            </main>
        </div>
    );
}
