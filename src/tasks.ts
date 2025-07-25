// Refinement Tasks are currently disabled.
// export function createMapTask(messageName: string, fieldName: string, onClick: () => void) {
//   return {
//     label: `Treat ${messageName}.${fieldName} as a map`,
//     run: onClick,
//   };
// }
// import type { Root } from 'protobufjs';
// export function convertFieldToMap(root: Root, messageName: string, fieldName: string) {
//   const msg = root.lookupType(messageName);
//   if (!msg) throw new Error(`Message ${messageName} not found`);
//   const field = msg.fields[fieldName];
//   if (!field) throw new Error(`Field ${fieldName} not found in ${messageName}`);
//   delete msg.fields[fieldName];
//   msg.add({
//     name: fieldName
//   });
// }

export type Task = {
  label: string;
  run: () => void;
};
