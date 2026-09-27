export const COMMAND_DEFINITIONS = [
  { id:'fetch-quran', name:'Fetch Quran', defaultEnabled:true },
  { id:'fetch-hadith', name:'Fetch Hadith', defaultEnabled:true },
  { id:'set-quran-provider', name:'Set Quran content provider', defaultEnabled:false },
  { id:'set-quran-language', name:'Set Quran translation language', defaultEnabled:false },
  { id:'set-quran-translation', name:'Set Quran translation', defaultEnabled:false },
  { id:'set-quran-website', name:'Set Quran link website', defaultEnabled:false },
  { id:'set-hadith-provider', name:'Set Hadith content provider', defaultEnabled:false },
  { id:'set-hadith-translation', name:'Set Hadith translation', defaultEnabled:false },
  { id:'manage-offline-databases', name:'Manage offline databases', defaultEnabled:false },
  { id:'check-provider-health', name:'Check provider health', defaultEnabled:true },
  { id:'normalize-salutations', name:'Normalize all salutations to ﷺ', defaultEnabled:true },
  { id:'convert-ra', name:'Convert Variants of RA used for the Sahaba to رَضِيَ اللهُ عَنْهُ', defaultEnabled:false },
  { id:'toggle-text-conversions', name:'Toggle Text Conversions', defaultEnabled:false },
] as const;

export type CommandId = typeof COMMAND_DEFINITIONS[number]['id'];
export type CommandVisibility = Record<CommandId, boolean>;

export function defaultCommandVisibility():CommandVisibility {
  return Object.fromEntries(COMMAND_DEFINITIONS.map(command => [command.id, command.defaultEnabled])) as CommandVisibility;
}
