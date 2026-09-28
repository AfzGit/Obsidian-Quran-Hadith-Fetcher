import { Editor, MarkdownView, Notice, Plugin } from 'obsidian';
import { ObsidianHttpClient } from './core/http';
import { OperationManager } from './core/operation';
import { errorToNotice, AppError } from './core/errors';
import { DEFAULT_FORMATTING, formatHadith, formatHadithRange, formatQuran } from './core/formatting';
import { normalizeBlessing, normalizeStandaloneRa, transformFetchedEnglishText, transformFetchedArabicText } from './core/normalization';
import { makeQuranUrl, validateTemplate } from './core/url';
import { parseHadithReference, parseQuranReference } from './parsing/references';
import { validateHadithReference, validateQuranReference } from './parsing/validation';
import { ProviderRegistry } from './providers/registry';
import { QuranUnlockedProvider } from './providers/quran-unlocked/provider';
import { AlQuranCloudProvider } from './providers/alquran-cloud/provider';
import { HadithUnlockedProvider } from './providers/hadith-unlocked/provider';
import { HadithApiProvider } from './providers/hadith-api/provider';
import { QuranApiProvider } from './providers/quran-api/provider';
import { QuranProjectProvider } from './providers/quran-project/provider';
import { HadithJsonProvider } from './providers/hadith-json/provider';
import { ObsidianOfflineDatabaseStore } from './obsidian/offline-store';
import { ObsidianPersistentJsonStore } from './obsidian/persistent-json-store';
import { migrateSettings, type Settings } from './settings/model';
import { ChoiceModal, CollectionModal, CommandVisibilityModal, InputModal, OptionsModal, PreviewModal, QuranSurahModal, OfflineDatabaseModal } from './obsidian/modals';
import { SURAH_NAMES } from './core/quran';
import { QURAN_WEBSITES } from './core/url';
import { COMMAND_DEFINITIONS, type CommandId } from './core/commands';
import { languageName } from './core/languages';
import { FetcherSettingTab } from './obsidian/settings-tab';
import type { CollectionDefinition, HadithResult, OutputOptions, QuranResult, TranslationDefinition } from './domain/models';
import type { OfflineDatabaseDefinition, InstalledOfflineDatabase, OfflineInstallProgress } from './domain/offline';

function applyDefaultHadithGrading(result:HadithResult):HadithResult {
  if (
    result.grades.length === 0 &&
    (result.reference.collectionId.toLocaleLowerCase('en-US') === 'bukhari' || result.reference.collectionId.toLocaleLowerCase('en-US') === 'muslim')
  ) {
    return {...result,grades:[{id:'default-sahih',text:'Sahih'}]};
  }
  return result;
}

function createNormalizers(pluginSettings: Settings) {
  const options = {
    textConversionsEnabled: pluginSettings.textConversionsEnabled,
    blessingNormalization: pluginSettings.blessingNormalization,
    raNormalization: pluginSettings.raNormalization,
    romanEnglish: pluginSettings.romanEnglish,
    codeSyntaxMode: pluginSettings.formatting.codeSyntaxMode,
    replacementRules: pluginSettings.replacementRules,
  } as const;
  const normalizeEnglish = (text: string) => transformFetchedEnglishText(text, options);
  const normalizeArabic = (text: string) => transformFetchedArabicText(text, options);
  return { normalizeEnglish, normalizeArabic };
}

export default class QuranHadithFetcherPlugin extends Plugin {
  declare pluginSettings: Settings;
  private readonly registry = new ProviderRegistry();
  private readonly operations = new OperationManager();
  private readonly http = new ObsidianHttpClient();
  private offlineStore!: ObsidianOfflineDatabaseStore;
  private hadithJsonBookCache!: ObsidianPersistentJsonStore;
  /** Serialize settings writes so rapid UI changes cannot race saveData(). */
  private settingsSaveQueue:Promise<void>=Promise.resolve();

  override async onload():Promise<void> {
    this.pluginSettings = migrateSettings(await this.loadData());
    this.offlineStore = new ObsidianOfflineDatabaseStore(this.app, this.manifest.id);
    this.hadithJsonBookCache = new ObsidianPersistentJsonStore(this.app, this.manifest.id, 'cache/hadith-json');
    this.registry.registerQuran(new QuranUnlockedProvider(this.http, () => this.pluginSettings.cacheEnabled));
    this.registry.registerQuran(new AlQuranCloudProvider(this.http, () => this.pluginSettings.cacheEnabled));
    this.registry.registerQuran(new QuranApiProvider(this.http, () => this.pluginSettings.cacheEnabled, this.offlineStore));
    this.registry.registerQuran(new QuranProjectProvider(this.http, () => this.pluginSettings.cacheEnabled, this.offlineStore));
    this.registry.registerHadith(new HadithUnlockedProvider(this.http, () => this.pluginSettings.cacheEnabled, this.offlineStore));
    this.registry.registerHadith(new HadithApiProvider(this.http, () => this.pluginSettings.cacheEnabled, this.offlineStore));
    this.registry.registerHadith(new HadithJsonProvider(this.http, () => this.pluginSettings.cacheEnabled, this.offlineStore, this.hadithJsonBookCache));
    this.registerCommands();
    this.addSettingTab(new FetcherSettingTab(this.app, this, () => this.runHealthChecks()));
  }

  async saveSettings() {
    // Snapshot after normalization so each queued write represents the settings state
    // at the moment the caller changed it, rather than whichever state exists later.
    this.pluginSettings = mangleFormatting(this.pluginSettings);
    const snapshot = structuredClone(this.pluginSettings);
    const write = this.settingsSaveQueue.then(() => this.saveData(snapshot));
    // Keep the queue usable after a failed write; the current call still receives the
    // original rejection so the UI can report it normally.
    this.settingsSaveQueue = write.then(() => undefined, () => undefined);
    await write;
  }

  async listQuranTranslations(providerId:string, signal?:AbortSignal):Promise<TranslationDefinition[]> {
    return this.registry.getQuran(providerId).listTranslations({signal:signal ?? new AbortController().signal});
  }

  async listHadithTranslations(providerId:string, signal?:AbortSignal):Promise<TranslationDefinition[]> {
    return this.registry.getHadith(providerId).listTranslations({signal:signal ?? new AbortController().signal});
  }

  getQuranProviderSummaries():{id:string;name:string;url:string;kind:'quran'}[]{ return this.registry.listQuran().map(p=>({id:p.metadata.id,name:p.metadata.name,url:p.metadata.projectUrl,kind:'quran'})); }
  getHadithProviderSummaries():{id:string;name:string;url:string;kind:'hadith'}[]{ return this.registry.listHadith().map(p=>({id:p.metadata.id,name:p.metadata.name,url:p.metadata.projectUrl,kind:'hadith'})); }

  openCommandPaletteSettings():void {
    const items=COMMAND_DEFINITIONS.map(command=>({id:command.id,name:command.name,enabled:this.pluginSettings.commandVisibility[command.id] !== false}));
    new CommandVisibilityModal(this.app,items,async enabled=>{
      this.pluginSettings.commandVisibility={...this.pluginSettings.commandVisibility,...enabled} as Settings['commandVisibility'];
      await this.saveSettings();
    }).open();
  }

  async listOfflineDatabases(signal?:AbortSignal):Promise<OfflineDatabaseDefinition[]> {
    const ctx={signal:signal ?? new AbortController().signal};
    const providers=[...this.registry.listQuran(),...this.registry.listHadith()];
    const results=await Promise.all(providers.map(provider=>provider.listOfflineDatabases(ctx)));
    return results.flat().sort((a,b)=>`${a.providerId}:${a.label}`.localeCompare(`${b.providerId}:${b.label}`));
  }

  async listInstalledOfflineDatabases():Promise<InstalledOfflineDatabase[]> { return this.offlineStore.listInstalled(); }

  async installOfflineDatabase(definition:OfflineDatabaseDefinition, signal:AbortSignal, onProgress?:(progress:OfflineInstallProgress)=>void):Promise<InstalledOfflineDatabase> {
    return this.offlineStore.install(definition,this.http,signal,onProgress);
  }

  async removeOfflineDatabase(databaseId:string):Promise<void> { await this.offlineStore.remove(databaseId); }

  private async saveLastOptions(kind:'quran'|'hadith', options:OutputOptions):Promise<void> {
    if (kind === 'quran') this.pluginSettings.lastQuranOptions = structuredClone(options);
    else this.pluginSettings.lastHadithOptions = structuredClone(options);
    await this.saveSettings();
  }

  private async runHealthChecks() {
    const providers = [...this.registry.listQuran(), ...this.registry.listHadith()];
    const ctx = { signal:new AbortController().signal };
    return Promise.all(providers.map(provider => provider.healthCheck(ctx)));
  }

  private getActiveEditor():Editor|null {
    return this.app.workspace.getActiveViewOfType(MarkdownView)?.editor ?? null;
  }

  private isCommandVisible(id:CommandId):boolean { return this.pluginSettings.commandVisibility[id] !== false; }

  // Command registration is data-driven from COMMAND_DEFINITIONS. Visibility is
  // checked in `checkCallback`, which means disabled commands disappear from normal
  // command-palette use without changing their underlying command implementation.
  private registerCommands():void {
    for(const command of COMMAND_DEFINITIONS){
      this.addCommand({
        id:command.id,
        name:command.name,
        checkCallback:(checking:boolean)=>{
          if(!this.isCommandVisible(command.id)) return false;
          const editorCommands = new Set<CommandId>(['fetch-quran','fetch-hadith','normalize-salutations','convert-ra']);
          if(editorCommands.has(command.id) && !this.getActiveEditor()) return false;
          if(checking) return true;
          void this.executeCommand(command.id);
          return true;
        },
      });
    }
  }

  // Central command dispatcher. Keep behavior here thin: choosing a provider or modal
  // belongs in dedicated methods, while actual fetching/formatting remains in their
  // existing orchestration helpers. This makes command IDs safe to rename through
  // settings migration without duplicating application logic.
  private async executeCommand(id:CommandId):Promise<void> {
    switch(id){
      case 'fetch-quran': { const editor=this.getActiveEditor(); if(editor) await this.insertQuran(editor); return; }
      case 'fetch-hadith': { const editor=this.getActiveEditor(); if(editor) await this.insertHadith(editor); return; }
      case 'set-quran-provider': return this.pickQuranProvider();
      case 'set-quran-language': return this.pickQuranLanguage();
      case 'set-quran-translation': return this.pickQuranTranslation();
      case 'set-quran-website': return this.pickQuranWebsite();
      case 'set-hadith-provider': return this.pickHadithProvider();
      case 'set-hadith-translation': return this.pickHadithTranslation();
      case 'manage-offline-databases': return this.openOfflineDatabaseManager();
      case 'check-provider-health': { await this.showProviderHealth(); return; }
      case 'normalize-salutations': return this.normalizeSelectedText('salutation');
      case 'convert-ra': return this.normalizeSelectedText('ra');
      case 'toggle-text-conversions': {
        this.pluginSettings.textConversionsEnabled=!this.pluginSettings.textConversionsEnabled;
        await this.saveSettings();
        new Notice(this.pluginSettings.textConversionsEnabled ? 'Text conversions enabled.' : 'Text conversions disabled.');
        return;
      }
    }
  }

  private async pickQuranProvider():Promise<void> {
    const providers=this.getQuranProviderSummaries();
    new ChoiceModal(this.app,providers,p=>`${p.id===this.pluginSettings.quranProvider?'🚩 ':''}${p.name} — URL: ${p.url}`,async p=>{
      this.pluginSettings.quranProvider=p.id;
      if(p.id==='alquran-cloud'){this.pluginSettings.quranLanguage='en';this.pluginSettings.quranTranslation='en.hilali';}
      else if(p.id==='quran-unlocked'){this.pluginSettings.quranLanguage='en';this.pluginSettings.quranTranslation='hilali-khan';}
      else if(p.id==='quran-api'){this.pluginSettings.quranLanguage='en';this.pluginSettings.quranTranslation='eng-muhammadtaqiudd';}
      else if(p.id==='quran-project'){this.pluginSettings.quranLanguage='en';this.pluginSettings.quranTranslation='en';}
      await this.saveSettings();
    },'Select Quran content provider').open();
  }

  private async pickQuranLanguage():Promise<void> {
    try {
      const translations=await this.listQuranTranslations(this.pluginSettings.quranProvider);
      const groups=[...new Map(translations.map(t=>[t.language.toLowerCase(),t.language])).entries()]
        .sort((a,b)=>languageName(a[0]).localeCompare(languageName(b[0])));
      const items=groups.map(([id,name])=>({id,name}));
      new ChoiceModal(this.app,items,item=>languageName(item.id),async item=>{
        this.pluginSettings.quranLanguage=item.id;
        const match=translations.find(t=>t.language.toLowerCase()===item.id.toLowerCase());
        if(match)this.pluginSettings.quranTranslation=match.id;
        await this.saveSettings();
      },'Select Quran translation language').open();
    } catch(error) { new Notice(errorToNotice(error)); }
  }

  private async pickQuranTranslation():Promise<void> {
    try {
      const translations=await this.listQuranTranslations(this.pluginSettings.quranProvider);
      const language=this.pluginSettings.quranLanguage.toLowerCase();
      const matches=translations.filter(t=>t.language.toLowerCase()===language);
      const items=(matches.length?matches:translations).map(t=>({translation:t,label:`${languageName(t.language)} — ${t.author ?? t.name}`}));
      new ChoiceModal(this.app,items,item=>item.label,async item=>{
        this.pluginSettings.quranLanguage=item.translation.language;
        this.pluginSettings.quranTranslation=item.translation.id;
        await this.saveSettings();
      },'Select Quran translation').open();
    } catch(error) { new Notice(errorToNotice(error)); }
  }

  private async pickQuranWebsite():Promise<void> {
    const items:Array<{id:Settings['quranWebsite'];label:string}>=Object.entries(QURAN_WEBSITES).map(([id,label])=>({id:id as Settings['quranWebsite'],label}));
    items.push({id:'custom',label:'Custom'});
    new ChoiceModal(this.app,items,item=>item.id==='custom' ? 'Custom' : item.label,async item=>{
      if(item.id!=='custom'){this.pluginSettings.quranWebsite=item.id as Settings['quranWebsite'];await this.saveSettings();return;}
      new InputModal(this.app,'Custom Quran URL','e.g. https://example.com/$surah/$ayah',this.pluginSettings.customQuranUrl,async value=>{this.pluginSettings.quranWebsite='custom';this.pluginSettings.customQuranUrl=value;await this.saveSettings();},()=>{},value=>{const invalid=validateTemplate(value);return value.includes('$surah') ? (invalid.length ? `Unknown URL placeholder(s): ${invalid.join(', ')}` : null) : 'URL template must contain $surah.';},'text').open();
    },'Select Quran website').open();
  }

  private async pickHadithProvider():Promise<void> {
    const providers=this.getHadithProviderSummaries();
    new ChoiceModal(this.app,providers,p=>`${p.id===this.pluginSettings.hadithProvider?'🚩 ':''}${p.name} — URL: ${p.url}`,async p=>{
      this.pluginSettings.hadithProvider=p.id;
      this.pluginSettings.hadithLanguage='en';
      this.pluginSettings.hadithTranslation=p.id==='hadith-api' ? 'eng' : 'en';
      await this.saveSettings();
    },'Select Hadith content provider').open();
  }

  private async pickHadithTranslation():Promise<void> {
    try {
      const translations=await this.listHadithTranslations(this.pluginSettings.hadithProvider);
      const items=translations.map(t=>({translation:t,label:`${languageName(t.language)} — ${t.name}`}));
      new ChoiceModal(this.app,items,item=>item.label,async item=>{
        this.pluginSettings.hadithLanguage=item.translation.language;
        this.pluginSettings.hadithTranslation=item.translation.id;
        await this.saveSettings();
      },'Select Hadith translation').open();
    } catch(error) { new Notice(errorToNotice(error)); }
  }

  private async openOfflineDatabaseManager():Promise<void> {
    try {
      const [definitions,installed]=await Promise.all([this.listOfflineDatabases(),this.listInstalledOfflineDatabases()]);
      const providers=[...this.getQuranProviderSummaries(),...this.getHadithProviderSummaries()];
      new OfflineDatabaseModal(this.app,definitions,installed,providers,
        async(definition,signal,progress)=>this.installOfflineDatabase(definition,signal,progress),
        async(databaseId)=>this.removeOfflineDatabase(databaseId),
      ).open();
    } catch(error) { new Notice(errorToNotice(error)); }
  }

  private async showProviderHealth():Promise<void> {
    new Notice('Checking provider health…');
    try {
      for(const result of await this.runHealthChecks()) new Notice(result.ok ? `SUCCESS: ${result.providerId} is reachable!` : `ERROR: ${result.message ?? `HTTP Code ${result.status ?? 'unknown'}`}`);
    } catch(error) { new Notice(errorToNotice(error)); }
  }

  private normalizeSelectedText(mode:'salutation'|'ra'):Promise<void> {
    const editor=this.getActiveEditor();
    if(!editor) { new Notice('No active editor.'); return Promise.resolve(); }
    const selected=editor.getSelection();
    if(selected) {
      const normalized=mode==='salutation' ? normalizeBlessing(selected) : normalizeStandaloneRa(selected);
      editor.replaceSelection(normalized);
      return Promise.resolve();
    }

    const cursor=editor.getCursor();
    const line=editor.getLine(cursor.line);
    const normalized=mode==='salutation' ? normalizeBlessing(line) : normalizeStandaloneRa(line);
    editor.replaceRange(normalized,{line:cursor.line,ch:0},{line:cursor.line,ch:line.length});
    return Promise.resolve();
  }

  /**
   * Orchestrate the complete Quran insertion flow: collect UI input, validate it,
   * fetch provider-neutral data, format it, and finally insert at the current editor
   * cursor. Keeping the stages explicit makes provider failures distinguishable from
   * formatting/cancellation failures and prevents UI code from parsing API payloads.
   */
  private async insertQuran(editor:Editor):Promise<void> {
    const operation = this.operations.begin();
    const selectedRef = parseQuranReference(editor.getSelection());
    if (selectedRef && validateQuranReference(selectedRef, this.pluginSettings.quranFetchLimit) === null) {
      await this.chooseQuranOptions(editor, selectedRef, operation.id, operation.signal);
      return;
    }
    new QuranSurahModal(this.app, async surah => this.chooseQuranAyahs(editor, surah, operation.id, operation.signal)).open();
  }

  private chooseQuranAyahs(editor:Editor, surah:number, id:number, signal:AbortSignal) {
    new InputModal(
      this.app,
      `Ayah — ${String(surah).padStart(3,'0')} ${SURAH_NAMES[surah-1]}`,
      'e.g. 13 or 13-15',
      '',
      async value => {
        const normalized = value.replace(/\s*[-–—]\s*/u, '-');
        const ref = parseQuranReference(`${surah}:${normalized}`);
        if (!ref) return;
        const error = validateQuranReference(ref, this.pluginSettings.quranFetchLimit);
        if (error) return;
        await this.chooseQuranOptions(editor, ref, id, signal);
      },
      () => this.operations.cancel(),
      value => {
        const normalized = value.replace(/\s*[-–—]\s*/u, '-');
        if (!/^\d{1,3}(?:-\d{1,3})?$/.test(normalized)) return 'Enter an ayah number or range, e.g. 1 or 1 - 10.';
        const ref=parseQuranReference(`${surah}:${normalized}`);
        return ref ? validateQuranReference(ref, this.pluginSettings.quranFetchLimit) : 'Invalid Ayah/range.';
      },
      'text',
    ).open();
  }

  private async chooseQuranOptions(editor:Editor, ref:Exclude<ReturnType<typeof parseQuranReference>,null>, id:number, signal:AbortSignal, initialOptions:OutputOptions=this.pluginSettings.lastQuranOptions) {
    new OptionsModal(
      this.app,
      initialOptions,
      {arabic:true, english:true, grading:false, quran:true},
      async options => {
        await this.saveLastOptions('quran', options);
        await this.fetchAndInsertQuran(editor, ref, id, signal, options);
      },
      () => this.operations.cancel(),
    ).open();
  }

  private async fetchAndInsertQuran(
    editor:Editor,
    ref:Exclude<ReturnType<typeof parseQuranReference>,null>,
    id:number,
    signal:AbortSignal,
    opts:OutputOptions = this.pluginSettings.lastQuranOptions,
  ) {
    try {
      const provider = this.registry.getQuran(this.pluginSettings.quranProvider);
      const rangeError=validateQuranReference(ref,this.pluginSettings.quranFetchLimit);
      if(rangeError) throw new AppError(rangeError,'validation');
      const translations = await provider.listTranslations({signal});
      const translation = translations.find(t => t.id === this.pluginSettings.quranTranslation && t.language.toLowerCase() === this.pluginSettings.quranLanguage.toLowerCase())
        ?? translations.find(t => t.id === this.pluginSettings.quranTranslation)
        ?? translations.find(t => t.id === 'hilali-khan')
        ?? translations.find(t => t.id === 'en.hilali')
        ?? translations.find(t => t.language.toLowerCase() === 'en')
        ?? translations[0];
      if (!translation && opts.english) throw new AppError('No English translation is configured for this provider.', 'validation');
      if (!translation) throw new AppError('No Quran translation is available for this provider.', 'validation');

      const result = await provider.fetchQuran(ref, translation, {signal});
      if (!this.operations.isCurrent(id)) return;

      const transformed:QuranResult = structuredClone(result);
      const { normalizeEnglish } = createNormalizers(this.pluginSettings);
      if (this.pluginSettings.romanEnglish) transformed.surahName = normalizeEnglish(transformed.surahName);
      for (const ayah of transformed.ayahs) {
        if (ayah.translation) ayah.translation.text = normalizeEnglish(ayah.translation.text);
        if (ayah.footnotes) for (const footnote of ayah.footnotes) footnote.text = normalizeEnglish(footnote.text);
      }
      transformed.source.sourceUrl = makeQuranUrl(this.pluginSettings.quranWebsite, this.pluginSettings.customQuranUrl, ref.surah, ref.startAyah, ref.endAyah, translation.id);
      transformed.source.providerId = provider.metadata.id;
      const markdown = formatQuran(transformed, {...this.pluginSettings.formatting, showLink:opts.link}, opts);
      new PreviewModal(
        this.app,
        markdown,
        edited => { if (this.operations.isCurrent(id)) editor.replaceRange(edited, editor.getCursor()); },
        () => { if (this.operations.isCurrent(id)) void this.chooseQuranOptions(editor,ref,id,signal,opts); },
      ).open();
    } catch (error) {
      if (!this.operations.isCurrent(id)) return;
      new Notice(errorToNotice(error));
    }
  }

  /**
   * Orchestrate Hadith insertion using the same high-level pipeline as Quran. The
   * provider is selected before fetching, while normalization/formatting remains
   * centralized so different Hadith sources produce a consistent Markdown shape.
   */
  private async insertHadith(editor:Editor):Promise<void> {
    const operation = this.operations.begin();
    const selectedRef = parseHadithReference(editor.getSelection());
    if (selectedRef) {
      const provider=this.registry.getHadith(this.pluginSettings.hadithProvider);
      try {
        const collections=await provider.listCollections({signal:operation.signal});
        const error=validateHadithReference(selectedRef,collections,this.pluginSettings.hadithFetchLimit);
        if(error){new Notice(`ERROR: ${error}`);return;}
      } catch(error) { new Notice(errorToNotice(error)); return; }
      await this.chooseHadithOptions(editor, selectedRef, operation.id, operation.signal);
      return;
    }
    const provider = this.registry.getHadith(this.pluginSettings.hadithProvider);
    let collections;
    try { collections = await provider.listCollections({signal:operation.signal}); }
    catch (error) { new Notice(errorToNotice(error)); return; }
    let offlineCollectionIds = new Set<string>();
    try {
      const installed = await this.offlineStore.listInstalled();
      offlineCollectionIds = this.getOfflineHadithCollectionIds(provider.metadata.id, installed);
    } catch {
      // Offline status is only UI decoration; collection selection must still work.
    }
    new CollectionModal(this.app, collections, collection => {
      const isMuslim = collection.id.toLocaleLowerCase('en-US') === 'muslim';
      new InputModal(this.app, `${collection.name} — Hadith`, isMuslim ? 'e.g. 202 or 202a' : 'e.g. 1 or 1-5', '', async value => {
        const normalized=value.replace(/\s*[-–—]\s*/u,'-');
        const ref=parseHadithReference(`${collection.id}:${normalized}`);
        if(!ref)return;
        await this.chooseHadithOptions(editor, ref, operation.id, operation.signal, collections);
      }, () => this.operations.cancel(), value => {
        const normalized=value.replace(/\s*[-–—]\s*/u,'-');
        const pattern=isMuslim ? /^\d{1,6}[a-z]?(?:-\d{1,6}[a-z]?)?$/iu : /^\d{1,6}(?:-\d{1,6})?$/u;
        if(!pattern.test(normalized)) return isMuslim ? 'Enter a Hadith number such as 202 or 202a.' : 'Enter a Hadith number or range, e.g. 1 or 1-5.';
        const ref=parseHadithReference(`${collection.id}:${normalized}`);
        return ref ? validateHadithReference(ref,collections,this.pluginSettings.hadithFetchLimit) : 'Invalid Hadith/range.';
      }, 'text').open();
    }, offlineCollectionIds).open();
  }

  private getOfflineHadithCollectionIds(providerId:string, installed:InstalledOfflineDatabase[]):Set<string> {
    const ids=new Set<string>();
    for(const database of installed){
      if(database.providerId!==providerId || database.kind!=='hadith') continue;
      const prefix=`${providerId}:`;
      if(!database.id.startsWith(prefix)) continue;
      const remainder=database.id.slice(prefix.length);
      const collectionId=providerId==='hadith-api'
        ? remainder.replace(/:eng$/u,'')
        : remainder;
      if(collectionId) ids.add(collectionId);
    }
    return ids;
  }

  private async chooseHadithOptions(editor:Editor, ref:Exclude<ReturnType<typeof parseHadithReference>,null>, id:number, signal:AbortSignal, knownCollections?:CollectionDefinition[], initialOptions:OutputOptions=this.pluginSettings.lastHadithOptions) {
    const provider = this.registry.getHadith(this.pluginSettings.hadithProvider);
    let collections = knownCollections;
    if (!collections) {
      try { collections = await provider.listCollections({signal}); }
      catch (error) { new Notice(errorToNotice(error)); return; }
    }
    const error = validateHadithReference(ref, collections, this.pluginSettings.hadithFetchLimit);
    if (error) { new Notice(`ERROR: ${error}`); return; }
    new OptionsModal(
      this.app,
      initialOptions,
      {
        arabic:provider.capabilities.arabicText,
        english:provider.capabilities.englishTranslation,
        // Bukhari and Muslim receive a default Sahih grade when the provider omits one.
        // Keep that fallback user-controlled even for providers without grade metadata.
        grading:provider.capabilities.grading || ['bukhari','muslim'].includes(ref.collectionId.toLowerCase()),
        isnad:provider.metadata.id === 'hadith-unlocked',
      },
      async options => { await this.saveLastOptions('hadith', options); await this.fetchAndInsertHadith(editor, ref, id, signal, options, collections); },
      () => this.operations.cancel(),
    ).open();
  }

  private async fetchAndInsertHadith(editor:Editor, ref:Exclude<ReturnType<typeof parseHadithReference>,null>, id:number, signal:AbortSignal, opts:OutputOptions = this.pluginSettings.lastHadithOptions, collections?:CollectionDefinition[]) {
    try {
      const provider = this.registry.getHadith(this.pluginSettings.hadithProvider);
      const translations = await provider.listTranslations({signal});
      const translation = translations.find(t => t.id === this.pluginSettings.hadithTranslation && t.language.toLowerCase() === this.pluginSettings.hadithLanguage.toLowerCase()) ?? translations.find(t => t.id === this.pluginSettings.hadithTranslation) ?? translations.find(t => t.language.toLowerCase() === this.pluginSettings.hadithLanguage.toLowerCase()) ?? translations.find(t => t.id === 'eng') ?? translations[0];
      if(!translation) throw new AppError('No Hadith translation is configured for this provider.','validation');
      const end=ref.endHadithNumber ?? ref.hadithNumber;
      if(typeof ref.hadithNumber === 'number' && typeof end === 'number' && end - ref.hadithNumber + 1 > this.pluginSettings.hadithFetchLimit) throw new AppError(`Hadith fetch limit is ${this.pluginSettings.hadithFetchLimit} hadiths.`,'validation');
      const results = await provider.fetchHadithRange(ref, translation, {signal});
      if (!this.operations.isCurrent(id)) return;
      const { normalizeArabic, normalizeEnglish } = createNormalizers(this.pluginSettings);
      const transformed:HadithResult[]=results.map(result=>{
        const gradedResult=applyDefaultHadithGrading(result);
        const item:HadithResult=structuredClone(gradedResult);
        if (item.arabicIsnad) item.arabicIsnad=normalizeArabic(item.arabicIsnad);
        if (item.arabic) item.arabic=normalizeArabic(item.arabic);
        if (item.englishIsnad) item.englishIsnad=normalizeEnglish(item.englishIsnad);
        if (item.english) item.english=normalizeEnglish(item.english);
        item.grades=item.grades.map(g=>({...g,text:normalizeEnglish(g.text)}));
        return item;
      });
      const markdown=transformed.length===1
        ? formatHadith(transformed[0]!, {...this.pluginSettings.formatting,showLink:opts.link}, opts)
        : formatHadithRange(transformed, {...this.pluginSettings.formatting,showLink:opts.link}, opts);
      new PreviewModal(
        this.app,
        markdown,
        edited => { if (this.operations.isCurrent(id)) editor.replaceRange(edited, editor.getCursor()); },
        () => { if (this.operations.isCurrent(id)) void this.chooseHadithOptions(editor,ref,id,signal,collections,opts); },
      ).open();
    } catch (error) {
      if (!this.operations.isCurrent(id)) return;
      new Notice(errorToNotice(error));
    }
  }
}

function mangleFormatting(pluginSettings:Settings):Settings { return {...pluginSettings, formatting:{...DEFAULT_FORMATTING,...pluginSettings.formatting}}; }
