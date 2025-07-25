// // jsonToProto.ts
// // Pure TypeScript library for converting JSON to Protobuf schema

// export interface JsonToProtoOptions {
//   packageName?: string;
//   messageName?: string;
// }

// export interface JsonToProtoResult {
//   proto: string;
//   warnings: string[];
// }

// export class JsonToProtoGenerator {
//   private messageCache: Map<string, string> = new Map();
//   private imports: Set<string> = new Set();

//   generate(jsonString: string, options: JsonToProtoOptions = {}): JsonToProtoResult {
//     this.imports.clear();
//     this.messageCache.clear();
//     let documents: any[] = [];
//     const nullProtoPaths: string[] = [];
//     const baseMessageName = options.messageName || 'RootMessage';
//     const packageName = options.packageName || '';

//     let docStrings: string[] = [];
//     docStrings = jsonString.split(/\n---+\n|\n{2,}/).map(s => s.trim()).filter(Boolean);
//     if (docStrings.length === 1 && docStrings[0].match(/^\s*\{[\s\S]*\}\s*\n\s*\{[\s\S]*\}/)) {
//       docStrings = jsonString.split(/(?<=\})\s*\n(?=\{)/).map(s => s.trim()).filter(Boolean);
//     }

//     for (const docStr of docStrings) {
//       try {
//         const parsed = JSON.parse(docStr);
//         documents.push(parsed);
//       } catch (e: any) {
//         return { proto: `Error: Invalid JSON - ${e.message}`, warnings: [] };
//       }
//     }
//     if (documents.length === 0) {
//       return { proto: "Error: No valid JSON documents found.", warnings: [] };
//     }

//     // Handle root-level primitives, arrays, and nulls
//     let fieldValues: Record<string, any[]> = {};
//     let rootType: string | null = null;
//     let rootValue: any = null;
//     if (documents.length === 1) {
//       const doc = documents[0];
//       if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) {
//         // Root is primitive, array, or null
//         rootType = Array.isArray(doc) ? 'array' : (doc === null ? 'null' : typeof doc);
//         rootValue = doc;
//       }
//     }
//     if (rootType) {
//       // Special handling for root null, array, or primitive
//       let fieldName = 'value';
//       let fieldObj: Record<string, any> = {};
//       if (rootType === 'null') {
//         this.imports.add('import "google/protobuf/struct.proto";');
//         fieldObj[fieldName] = null;
//       } else if (rootType === 'array') {
//         if (Array.isArray(rootValue) && rootValue.length === 0) {
//           this.imports.add('import "google/protobuf/any.proto";');
//           fieldObj[fieldName] = [];
//         } else if (Array.isArray(rootValue)) {
//           // Arrays of arrays: flatten and emit repeated fields for each index
//           if (rootValue.every(item => Array.isArray(item))) {
//             // Find max length
//             const maxLen = Math.max(...rootValue.map(arr => arr.length));
//             for (let i = 0; i < maxLen; i++) {
//               fieldObj[`_${i}`] = rootValue.map(arr => arr[i]).filter(v => v !== undefined);
//             }
//           } else if (rootValue.every(item => typeof item === 'object' && item !== null && !Array.isArray(item))) {
//             // Arrays of objects: merge all possible fields
//             const allKeys = Array.from(new Set(rootValue.flatMap(obj => Object.keys(obj))));
//             for (const key of allKeys) {
//               fieldObj[key] = rootValue.map(obj => obj[key]);
//             }
//           } else {
//             // Check for mixed types
//             const types = new Set(rootValue.map(v => v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v));
//             if (types.size > 1 || types.has('null')) {
//               this.imports.add('import "google/protobuf/struct.proto";');
//               fieldObj[fieldName] = [null]; // force mixed type
//             } else {
//               fieldObj[fieldName] = rootValue;
//             }
//           }
//         }
//       } else {
//         fieldObj[fieldName] = rootValue;
//       }
//       fieldValues = { ...fieldObj };
//     } else {
//       for (const doc of documents) {
//         if (Array.isArray(doc)) {
//           if (doc.length > 0 && doc.every(item => Array.isArray(item))) {
//             // Arrays of arrays at root
//             const maxLen = Math.max(...doc.map(arr => arr.length));
//             for (let i = 0; i < maxLen; i++) {
//               fieldValues[`_${i}`] = doc.map(arr => arr[i]).filter(v => v !== undefined);
//             }
//           } else if (doc.length > 0 && doc.every(item => typeof item === 'object' && item !== null && !Array.isArray(item))) {
//             // Arrays of objects at root: merge all possible fields
//             const allKeys = Array.from(new Set(doc.flatMap(obj => Object.keys(obj))));
//             for (const key of allKeys) {
//               fieldValues[key] = doc.map(obj => obj[key]);
//             }
//           } else {
//             for (const item of doc) {
//               if (typeof item === 'object' && item !== null) {
//                 for (const key of Object.keys(item)) {
//                   if (!fieldValues[key]) fieldValues[key] = [];
//                   fieldValues[key].push(item[key]);
//                 }
//               }
//             }
//           }
//         } else if (typeof doc === 'object' && doc !== null) {
//           for (const key of Object.keys(doc)) {
//             if (!fieldValues[key]) fieldValues[key] = [];
//             fieldValues[key].push(doc[key]);
//           }
//         }
//       }
//     }

//     function findNullProtoPaths(obj: any, protoPath: string[], packageName: string, messageName: string) {
//       if (obj === null) {
//         const fullPath = [packageName, ...protoPath].filter(Boolean).join('.');
//         nullProtoPaths.push(fullPath);
//         return;
//       }
//       if (Array.isArray(obj)) {
//         obj.forEach((item, idx) => findNullProtoPaths(item, [...protoPath, `[${idx}]`], packageName, messageName));
//       } else if (typeof obj === 'object' && obj !== null) {
//         Object.entries(obj).forEach(([key, value]) => {
//           findNullProtoPaths(value, [...protoPath, key], packageName, messageName);
//         });
//       }
//     }

//     const mergedExample: Record<string, any> = {};
//     for (const key of Object.keys(fieldValues)) {
//       const arr = fieldValues[key];
//       if (arr && arr.length > 0) {
//         mergedExample[key] = arr[0];
//       } else {
//         mergedExample[key] = null;
//       }
//     }
//     findNullProtoPaths(mergedExample, [baseMessageName], packageName, baseMessageName);

//     const topMessage = this.generateMessageDef(fieldValues, baseMessageName);

//     const header = [
//       'syntax = "proto3";',
//       packageName ? `package ${packageName};` : '',
//       ...Array.from(this.imports)
//     ].filter(Boolean).join('\n');

//     const protoText = `${header}\n\n${topMessage}`;
//     const warnings: string[] = [];
//     if (nullProtoPaths.length > 0) {
//       warnings.push(
//         `Warning: The type \"NullValue\" was used. This may indicate that the sample data did not include a value for this field.\nAffected proto path(s):\n${nullProtoPaths.map(p => `- ${p}`).join('\n')}`
//       );
//     }
//     if (protoText.includes('google.protobuf.Value')) {
//       warnings.push(
//         'Warning: google.protobuf.Value is used for fields with mixed or ambiguous types. This type allows any value, which may not be ideal for strict schemas. Consider reviewing these fields.'
//       );
//     }
//     if (/\bdouble\b/.test(protoText)) {
//       warnings.push('Warning: float64 (double) detected. Protobuf double may lose precision for very large numbers.');
//     }
//     return { proto: protoText, warnings };
//   }

//   private generateMessageDef(obj: Record<string, any>, messageName: string): string {
//     let fieldIndex = 1;
//     const fields: string[] = [];
//     const nestedMessages: string[] = [];
//     const seenFieldNames = new Set<string>();
//     const fieldTypes: Record<string, Set<string>> = {};
//     const fieldValues: Record<string, any[]> = {};

//     for (const key in obj) {
//       if (Object.prototype.hasOwnProperty.call(obj, key)) {
//         // Prefix numeric keys with _
//         let fieldName = toSnakeCase(key);
//         if (/^\d/.test(fieldName)) {
//           fieldName = `_${fieldName}`;
//         }
//         if (!fieldTypes[fieldName]) fieldTypes[fieldName] = new Set();
//         if (!fieldValues[fieldName]) fieldValues[fieldName] = [];
//         const value = obj[key];
//         let typeSig: string = typeof value;
//         if (value === null) typeSig = 'null';
//         else if (Array.isArray(value)) typeSig = 'array';
//         fieldTypes[fieldName].add(typeSig);
//         fieldValues[fieldName].push(value);
//       }
//     }

//     const signatureParts: string[] = [];
//     Object.keys(fieldTypes).forEach(fieldName => {
//       signatureParts.push(`${fieldName}:${Array.from(fieldTypes[fieldName]).join('|')}`);
//     });
//     const signature = `${messageName}|${signatureParts.join(',')}`;
//     if (this.messageCache.has(signature)) {
//       return this.messageCache.get(signature)!;
//     }

//     for (const fieldName of Object.keys(fieldTypes)) {
//       if (seenFieldNames.has(fieldName)) continue;
//       seenFieldNames.add(fieldName);
//       const types = Array.from(fieldTypes[fieldName]);
//       const values = fieldValues[fieldName];
//       const nonNullValues = values.filter(v => v !== null);
//       const allArrays = nonNullValues.length > 0 && nonNullValues.every(v => Array.isArray(v));
//       let comment = '';
//       let fieldLine = '';
//       if (values.every(v => v === null)) {
//         this.imports.add('import "google/protobuf/struct.proto";');
//         comment = '// Ambiguous: All values are null in the sample data.';
//         fieldLine = `google.protobuf.Value ${fieldName} = ${fieldIndex++};`;
//       } else if (types.length > 1 || types.includes('null')) {
//         this.imports.add('import "google/protobuf/struct.proto";');
//         comment = '// Ambiguous: Field has mixed or conflicting types in the sample data.';
//       } else if (allArrays) {
//         // Check if array contains objects with missing fields (merge all fields)
//         const value = values.find(v => Array.isArray(v));
//         if (value && value.length > 0 && value.every((item: any) => typeof item === 'object' && item !== null && !Array.isArray(item))) {
//           // Merge all keys and types
//           const allKeys = Array.from(new Set(value.flatMap((obj: any) => Object.keys(obj))));
//           let nestedObj: Record<string, any> = {};
//           for (const key of allKeys) {
//             nestedObj[key] = value.map((obj: any) => obj[key]);
//           }
//           // For each field, determine merged type
//           for (const key of allKeys) {
//             const arr = nestedObj[key];
//             const arrTypes = Array.from(new Set(arr.map((v: any) => v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v)));
//             if (arr.every((v: any) => v === null) || arrTypes.length > 1 || arrTypes.includes('null')) {
//               this.imports.add('import "google/protobuf/struct.proto";');
//               nestedObj[key] = [null]; // force Value
//             }
//           }
//           const nestedMessageName = toPascalCase(fieldName);
//           nestedMessages.push(this.generateMessageDef(nestedObj, nestedMessageName));
//           fieldLine = `repeated ${nestedMessageName} ${fieldName} = ${fieldIndex++};`;
//         } else {
//           let protoType = 'google.protobuf.Any';
//           if (value && value.length > 0) {
//             // If mixed types or null, emit Value
//             const arrTypes = Array.from(new Set(value.map((v: any) => v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v)));
//             if (value.every((v: any) => v === null) || arrTypes.length > 1 || arrTypes.includes('null')) {
//               this.imports.add('import "google/protobuf/struct.proto";');
//               protoType = 'google.protobuf.Value';
//             } else {
//               protoType = this.getProtoType(value[0], fieldName, messageName, nestedMessages);
//               if (protoType.startsWith('repeated ')) {
//                 protoType = protoType.replace(/^repeated\s+/, '');
//               }
//             }
//           }
//           fieldLine = `repeated ${protoType} ${fieldName} = ${fieldIndex++};`
//         }
//         // (Remove erroneous scalarType block)
//       }
//       if (comment) {
//         fields.push(`  ${comment}`);
//       }
//       fields.push(`  ${fieldLine}`);
//     }

//     let messageBody = `message ${messageName} {\n${fields.join('\n')}`;
//     const uniqueNestedMessages = Array.from(new Set(nestedMessages));
//     if (uniqueNestedMessages.length > 0) {
//       messageBody += '\n\n' + uniqueNestedMessages.map(m => m.replace(/^/gm, '  ')).join('\n\n');
//     }
//     messageBody += '\n}';
//     this.messageCache.set(signature, messageBody);
//     return messageBody;
//   }

//   private getProtoType(value: any, fieldName: string, parentMessageName: string, nestedMessages: string[]): string {
//     switch (typeof value) {
//       case 'string':
//         return 'string';
//       case 'number':
//         return Number.isInteger(value) ? 'int64' : 'double';
//       case 'boolean':
//         return 'bool';
//       case 'object':
//         if (value === null) {
//           this.imports.add('import "google/protobuf/struct.proto";');
//           return 'google.protobuf.NullValue';
//         }
//         if (Array.isArray(value)) {
//           return this.getArrayType(value, fieldName, parentMessageName, nestedMessages);
//         }
//         const nestedMessageName = toPascalCase(fieldName);
//         nestedMessages.push(this.generateMessageDef(value, nestedMessageName));
//         return nestedMessageName;
//       default:
//         this.imports.add('import "google/protobuf/any.proto";');
//         return 'google.protobuf.Any';
//     }
//   }

//   private getArrayType(arr: any[], fieldName: string, parentMessageName: string, nestedMessages: string[]): string {
//     if (arr.length === 0) {
//       this.imports.add('import "google/protobuf/any.proto";');
//       return 'repeated google.protobuf.Any';
//     }
//     const types = new Set<string>();
//     arr.forEach(item => {
//       const singularFieldName = fieldName.endsWith('s') ? fieldName.slice(0, -1) : `${fieldName}_element`;
//       types.add(this.getProtoType(item, singularFieldName, parentMessageName, nestedMessages));
//     });
//     if (types.size === 1) {
//       const singleType = types.values().next().value;
//       return `repeated ${singleType}`;
//     }
//     if (types.size === 2 && types.has('int64') && types.has('double')) {
//       return 'repeated double';
//     }
//     this.imports.add('import "google/protobuf/struct.proto";');
//     return 'repeated google.protobuf.Value';
//   }
// }

// function toSnakeCase(str: string): string {
//   return str.replace(/([A-Z])/g, '_$1').replace(/[-\s]+/g, '_').replace(/^_+/, '').toLowerCase();
// }

// function toPascalCase(str: string): string {
//   return str.replace(/(^|_|\s|-)(\w)/g, (_, __, c) => c ? c.toUpperCase() : '').replace(/\W/g, '');
// }
