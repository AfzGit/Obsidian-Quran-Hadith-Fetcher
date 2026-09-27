import { formatScholarName } from '../core/names';
import { SURAH_NAMES } from '../core/quran';
import { FuzzySuggestModal, Modal, Notice, Setting, setIcon, type App } from 'obsidian';
import type { CollectionDefinition, OutputOptions, ProviderKind } from '../domain/models';
import type { InstalledOfflineDatabase, OfflineDatabaseDefinition, OfflineInstallProgress } from '../domain/offline';
import type { ReplacementRule } from '../core/normalization';
import { normalizeHadithCollectionMetadata } from '../core/catalog';

interface OfflineProviderSummary { id:string; name:string; kind:ProviderKind; }



/**
 * Normalize searchable UI labels without changing the underlying stored value.
 * NFKC collapses compatible Unicode forms and the fixed English locale makes search
 * behavior deterministic across devices with different locale settings.
 */
export function normalizeChoiceText(value:string):string { return value.normalize('NFKC').trim().toLocaleLowerCase('en-US'); }

function decodeHtmlEntities(value:string):string {
  return value
    .replace(/&#39;|&#x27;|&apos;/gi, "'")
    .replace(/&quot;|&#x22;/gi, '"')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, n:string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n:string) => String.fromCodePoint(parseInt(n,16)));
}

// Modal implementations below keep drafts local until their primary action is
// confirmed. Cancel/Escape must be side-effect free, which is particularly important
// for Add Conversion: an unsaved draft must never create an empty settings row.
export class InputModal extends Modal {
  private input!: HTMLInputElement;
  private errorEl!: HTMLElement;
  constructor(app:App, private readonly title:string, private readonly placeholder:string, private readonly initial:string, private readonly onSubmit:(value:string)=>void, private readonly onCancel:()=>void, private readonly validateInput?:(value:string)=>string|null, private readonly inputMode:HTMLInputElement['inputMode']='numeric'){ super(app); }
  override onOpen():void {
    this.contentEl.empty();
    this.titleEl.setText(this.title);
    new Setting(this.contentEl).setName('Reference').addText(t=>{this.input=t.inputEl;t.setPlaceholder(this.placeholder).setValue(this.initial);this.input.inputMode=this.inputMode;this.input.autocomplete='off';this.input.spellcheck=false;});
    this.errorEl=this.contentEl.createDiv({cls:'qhf-input-error'});
    const row=this.contentEl.createDiv({cls:'qhf-modal-actions'});
    row.createEl('button',{text:'Cancel'}).onclick=()=>{this.close();this.onCancel();};
    const submit=row.createEl('button',{text:'Continue',cls:'mod-cta'});
    const submitValue=()=>{
      const value=this.input.value.trim();
      const error=this.validateInput?.(value) ?? null;
      if(error){this.errorEl.setText(error);this.input.addClass('qhf-invalid');this.input.setAttribute('aria-invalid','true');this.input.focus();return;}
      this.input.removeClass('qhf-invalid');
      this.input.removeAttribute('aria-invalid');
      this.errorEl.empty();
      this.close();
      this.onSubmit(value);
    };
    submit.onclick=submitValue;
    this.input.addEventListener('keydown',(e)=>{if(e.key==='Enter'){e.preventDefault();submitValue();}if(e.key==='Escape'){this.close();this.onCancel();}});
    setTimeout(()=>this.input.focus(),0);
  }
  override onClose():void { this.contentEl.empty(); }
}

export class ChoiceModal<T> extends FuzzySuggestModal<T> {
  constructor(
    app:App,
    private readonly items:T[],
    private readonly getText:(item:T)=>string,
    private readonly onChoose:(item:T)=>void|Promise<void>,
    placeholder='Choose…',
  ){ super(app); this.setPlaceholder(placeholder); }
  override getItems():T[]{ return this.items; }
  override getItemText(item:T):string{ return this.getText(item); }
  override onChooseItem(item:T):void{ this.close(); void this.onChoose(item); }
}

export interface CommandVisibilityItem { id:string; name:string; enabled:boolean; }

export class CommandVisibilityModal extends Modal {
  constructor(
    app:App,
    private readonly items:CommandVisibilityItem[],
    private readonly onSave:(enabled:Record<string,boolean>)=>void|Promise<void>,
  ){ super(app); }
  override onOpen():void {
    this.contentEl.empty();
    this.titleEl.setText('Command palette');
    const draft=Object.fromEntries(this.items.map(item=>[item.id,item.enabled]));
    for(const item of this.items){
      new Setting(this.contentEl).setName(item.name).addToggle(t=>t.setValue(item.enabled).onChange(v=>{draft[item.id]=v;}));
    }
    const row=this.contentEl.createDiv({cls:'qhf-modal-actions'});
    row.createEl('button',{text:'Cancel'}).onclick=()=>this.close();
    row.createEl('button',{text:'Save',cls:'mod-cta'}).onclick=()=>{this.close();void this.onSave(draft);};
  }
  override onClose():void{ this.contentEl.empty(); }
}

export class QuranSurahModal extends FuzzySuggestModal<{number:number;name:string}> {
  constructor(app:App, private readonly onChoose:(surah:number)=>void){ super(app); this.setPlaceholder('Search surah…'); }
  override getItems(){return SURAH_NAMES.map((name,i)=>({number:i+1,name}));}
  override getItemText(item:{number:number;name:string}){return `${String(item.number).padStart(3,'0')} ${item.name}`;}
  override onChooseItem(item:{number:number;name:string}){this.close();this.onChoose(item.number);}
}

export class CollectionModal extends FuzzySuggestModal<CollectionDefinition> {
  constructor(
    app:App,
    private readonly collections:CollectionDefinition[],
    private readonly onChoose:(collection:CollectionDefinition)=>void,
    private readonly offlineCollectionIds:ReadonlySet<string>=new Set(),
  ){
    super(app);
    this.setPlaceholder('Search collection…');
  }
  override getItems(){return this.collections;}
  override getItemText(item:CollectionDefinition){
    const normalized=normalizeHadithCollectionMetadata(item);
    const name=decodeHtmlEntities(normalized.name);
    const author=normalized.author ? formatScholarName(decodeHtmlEntities(normalized.author)) : '';
    const base=author ? `${name} — ${author}` : name;
    return this.offlineCollectionIds.has(item.id) ? `${base} ⬇️` : base;
  }
  override onChooseItem(item:CollectionDefinition){this.close();this.onChoose(item);}
}

export class OptionsModal extends Modal {
  constructor(
    app:App,
    private readonly initial:OutputOptions,
    private readonly capabilities:{arabic:boolean;english:boolean;grading:boolean;quran?:boolean;isnad?:boolean},
    private readonly onSubmit:(options:OutputOptions)=>void|Promise<void>,
    private readonly onCancel:()=>void,
  ){super(app);}

  override onOpen(){
    this.contentEl.empty();
    this.titleEl.setText('Output options');
    const opts:OutputOptions={...this.initial};
    const make=(name:'arabic'|'english'|'grading'|'link'|'quranFootnotes'|'hadithSeparateIsnad',label:string,enabled:boolean)=>{
      const setting=new Setting(this.contentEl).setName(label);
      if(!enabled) { setting.setDisabled(true); opts[name]=false; }
      setting.addToggle(t=>t.setValue(enabled && opts[name]).onChange(v=>{opts[name]=v;}));
    };

    make('arabic','Arabic text',this.capabilities.arabic);
    make('english','English text',this.capabilities.english);
    if(this.capabilities.grading && !this.capabilities.quran) make('grading','Grading',true);
    make('link','Insert link',true);

    if(this.capabilities.quran){
      make('quranFootnotes','Footnotes',true);
      new Setting(this.contentEl)
        .setName('Ayah formatting')
        .setDesc('Choose how a Quran range is arranged.')
        .addDropdown(d=>d
          .addOptions({
            'line-by-line':'Line by line',
            'merged':'Merge ayahs',
            'alternate':'Alternate Arabic / English',
            'numbered':'Line by line with numbering',
          })
          .setValue(opts.quranRangeMode)
          .onChange(v=>{opts.quranRangeMode=v as OutputOptions['quranRangeMode'];}));
    }

    if(this.capabilities.isnad) make('hadithSeparateIsnad','Chain of Narration (Isnaad)',true);

    const row=this.contentEl.createDiv({cls:'qhf-modal-actions'});
    const cancel=row.createEl('button',{text:'Cancel'});
    cancel.onclick=()=>{this.close();this.onCancel();};
    const submit=row.createEl('button',{text:'Fetch',cls:'mod-cta'});
    let fetching=false;
    const submitOptions=async()=>{
      if(fetching)return;
      fetching=true;
      submit.disabled=true;
      cancel.disabled=true;
      submit.empty();
      setIcon(submit,'loader-circle');
      const label=submit.createSpan({text:' Fetching…'});
      label.addClass('qhf-fetching-label');
      try { await this.onSubmit(opts); }
      finally { this.close(); }
    };
    submit.onclick=()=>{void submitOptions();};
    this.contentEl.addEventListener('keydown',(e)=>{
      if(e.key==='Enter'){
        e.preventDefault(); e.stopPropagation(); void submitOptions();
      }
    },true);
    setTimeout(()=>submit.focus(),0);
  }
}



export class ReplacementRuleModal extends Modal {
  constructor(
    app:App,
    private readonly rule:ReplacementRule,
    private readonly onSave:(draft:ReplacementRule)=>void|Promise<void>,
    private readonly onDelete:()=>void|Promise<void>,
    private readonly onCancel:()=>void,
    private readonly textConversionsEnabled: boolean | (() => boolean)=true,
    private readonly isNew=false,
  ){ super(app); }

  override onOpen():void {
    this.contentEl.empty();
    this.titleEl.setText(this.isNew ? 'Add text conversion' : 'Edit text conversion');
    const textConversionsEnabled=typeof this.textConversionsEnabled === 'function' ? this.textConversionsEnabled() : this.textConversionsEnabled;
    if(!textConversionsEnabled){
      const warning=this.contentEl.createDiv({cls:'qhf-text-conversion-warning mod-warning',attr:{role:'alert'}});
      warning.createEl('strong',{text:'Text conversions are currently disabled.'});
      warning.createEl('div',{text:'Changes made here will still be saved, but they will not be applied to fetched text until Text Conversions is enabled in settings.'});
    }
    const draft:ReplacementRule={...this.rule};

    new Setting(this.contentEl).setName('Title').setDesc('Name shown in Text Conversion settings.')
      .addText(t=>t.setValue(draft.title).onChange(v=>{draft.title=v;}));
    new Setting(this.contentEl).setName('Description').setDesc('Optional description.')
      .addTextArea(t=>{t.setValue(draft.description);t.inputEl.rows=2;t.onChange(v=>{draft.description=v;});});
    new Setting(this.contentEl).setName('Preconversion').setDesc('Whole words only; matching is case-insensitive.')
      .addText(t=>t.setValue(draft.from).onChange(v=>{draft.from=v;updateValidation();}));
    new Setting(this.contentEl).setName('Postconversion')
      .addText(t=>t.setValue(draft.to).onChange(v=>{draft.to=v;updateValidation();}));
    new Setting(this.contentEl).setName('Enabled')
      .addToggle(t=>t.setValue(draft.enabled).onChange(v=>{draft.enabled=v;}));

    const validation=this.contentEl.createDiv({cls:'qhf-validation-message'});
    const isValid=()=>draft.from.trim().length>0 && draft.to.trim().length>0;
    const updateValidation=()=>{validation.setText(isValid() ? '' : 'Preconversion and postconversion are required.');saveButton.disabled=!isValid();};
    const actions=this.contentEl.createDiv({cls:'qhf-modal-actions'});
    actions.createEl('button',{text:'Cancel'}).onclick=()=>{this.close();this.onCancel();};
    actions.createEl('button',{text:'Delete'}).onclick=()=>{this.close();void this.onDelete();};
    const saveButton=actions.createEl('button',{text:'Save',cls:'mod-cta'});
    saveButton.onclick=()=>{if(!isValid()){updateValidation();return;}Object.assign(this.rule,draft);this.close();void this.onSave(draft);};
    updateValidation();
  }
}

export class PreviewModal extends Modal {
  private textarea!: HTMLTextAreaElement;
  private insertButton!: HTMLButtonElement;
  constructor(app:App, private readonly markdown:string, private readonly onInsert:(markdown:string)=>void, private readonly onBack?:()=>void){super(app);}
  override onOpen(){
    this.contentEl.empty();
    this.modalEl.addClass('qhf-preview-modal');
    this.titleEl.setText('Preview');
    this.textarea=this.contentEl.createEl('textarea',{cls:'qhf-preview'});
    this.textarea.value=this.markdown;
    this.textarea.readOnly=false;
    this.textarea.rows=30;
    this.textarea.spellcheck=false;
    const row=this.contentEl.createDiv({cls:'qhf-modal-actions'});
    if(this.onBack) row.createEl('button',{text:'Back'}).onclick=()=>{this.close();this.onBack?.();};
    row.createEl('button',{text:'Cancel'}).onclick=()=>this.close();
    row.createEl('button',{text:'Copy'}).onclick=async()=>{
      try{
        // Clipboard.writeText is the cross-platform Web API recommended by Obsidian.
        // It can be unavailable or restricted by a particular mobile webview, so keep
        // the older selection-based fallback for environments where direct clipboard
        // access is not exposed. The button click supplies the user gesture required
        // by mobile browsers for clipboard writes.
        if(navigator.clipboard?.writeText){
          await navigator.clipboard.writeText(this.textarea.value);
        } else {
          this.textarea.focus();
          this.textarea.select();
          if(!document.execCommand('copy')) throw new Error('Clipboard copy is unavailable.');
        }
        this.close();
        new Notice('Copied to clipboard.');
      }catch{
        try{
          this.textarea.focus();
          this.textarea.select();
          if(!document.execCommand('copy')) throw new Error('Clipboard copy is unavailable.');
          this.close();
          new Notice('Copied to clipboard.');
        }catch{
          new Notice('Could not copy to clipboard.');
        }
      }
    };
    this.insertButton=row.createEl('button',{text:'Insert',cls:'mod-cta'});
    this.insertButton.onclick=()=>{const value=this.textarea.value;this.close();this.onInsert(value);};

    // Obsidian may restore focus to the preview textarea while the modal is
    // settling. Re-assert focus on the primary action after the modal has
    // finished opening, with a second frame as a fallback for focus traps.
    const focusInsertButton=()=>{
      this.textarea.blur();
      this.insertButton.focus({preventScroll:true});
    };
    requestAnimationFrame(()=>{
      focusInsertButton();
      requestAnimationFrame(focusInsertButton);
    });
    setTimeout(focusInsertButton,50);
  }
  override onClose(){this.modalEl.removeClass('qhf-preview-modal');this.contentEl.empty();}
}


export class OfflineDatabaseModal extends Modal {
  private readonly states = new Map<string, InstalledOfflineDatabase>();
  private readonly controllers = new Set<AbortController>();
  private searchInput!: HTMLInputElement;
  private listEl!: HTMLElement;
  private statusEl!: HTMLElement;
  private definitions: OfflineDatabaseDefinition[];
  private readonly providers: OfflineProviderSummary[];
  private showDownloadedOnly=false;
  private showQuran=true;
  private showQuranTranslation=true;
  private showHadith=true;

  constructor(
    app:App,
    definitions:OfflineDatabaseDefinition[],
    installed:InstalledOfflineDatabase[],
    providers:OfflineProviderSummary[],
    private readonly onInstall:(definition:OfflineDatabaseDefinition,signal:AbortSignal,onProgress:(progress:OfflineInstallProgress)=>void)=>Promise<InstalledOfflineDatabase>,
    private readonly onRemove:(databaseId:string)=>Promise<void>,
  ) {
    super(app);
    this.providers=providers;
    for(const item of installed)this.states.set(item.id,item);
    const known=new Set(definitions.map(item=>item.id));
    const installedDefinitions:OfflineDatabaseDefinition[]=installed
      .filter(item=>!known.has(item.id))
      .map(item=>({
        id:item.id,providerId:item.providerId,kind:item.kind,label:item.label,
        description:item.description || 'Installed offline database.',parts:[],
      }));
    this.definitions=[...definitions,...installedDefinitions];
  }

  override onOpen():void {
    this.contentEl.empty();
    this.titleEl.setText('Offline databases');
    new Setting(this.contentEl).setName('Search').addText(t=>{
      this.searchInput=t.inputEl;
      t.setPlaceholder('Search provider, book, language, or author…');
      this.searchInput.oninput=()=>this.render();
    });

    const filterRow=this.contentEl.createDiv({cls:'qhf-offline-filters'});
    this.createFilterButton(filterRow,'Downloaded',()=>{
      this.showDownloadedOnly=!this.showDownloadedOnly;
      this.render();
    },()=>this.showDownloadedOnly);
    this.createFilterButton(filterRow,'Quran',()=>{
      this.showQuran=!this.showQuran;
      this.render();
    },()=>this.showQuran);
    this.createFilterButton(filterRow,'Quran Translation',()=>{
      this.showQuranTranslation=!this.showQuranTranslation;
      this.render();
    },()=>this.showQuranTranslation);
    this.createFilterButton(filterRow,'Hadith',()=>{
      this.showHadith=!this.showHadith;
      this.render();
    },()=>this.showHadith);

    this.statusEl=this.contentEl.createDiv({cls:'qhf-offline-status'});
    this.listEl=this.contentEl.createDiv({cls:'qhf-offline-list'});
    this.render();
    setTimeout(()=>this.searchInput.focus(),0);
  }

  private createFilterButton(parent:HTMLElement,label:string,onClick:()=>void,isActive:()=>boolean):HTMLButtonElement {
    const button=parent.createEl('button',{text:label,cls:'qhf-filter-button'});
    button.type='button';
    const sync=()=>{
      const active=isActive();
      button.setAttribute('aria-pressed',String(active));
      button.toggleClass('qhf-filter-active',active);
    };
    button.onclick=()=>{onClick();sync();};
    sync();
    return button;
  }

  private matches(definition:OfflineDatabaseDefinition,query:string):boolean {
    const downloaded=this.states.has(definition.id);
    if(this.showDownloadedOnly && !downloaded) return false;
    const categories=definition.categories?.length ? definition.categories : (definition.category ? [definition.category] : [definition.kind]);
    const hasQuran=categories.includes('quran');
    const hasQuranTranslation=categories.includes('quran-translation');
    const hasHadith=categories.includes('hadith');
    if(hasHadith && !this.showHadith) return false;
    if((hasQuran || hasQuranTranslation) && !(hasQuran && this.showQuran) && !(hasQuranTranslation && this.showQuranTranslation)) return false;
    return !query || `${definition.providerId} ${definition.label} ${definition.description}`.toLocaleLowerCase('en-US').includes(query);
  }

  private providerMatches(provider:OfflineProviderSummary,query:string):boolean {
    if(this.showDownloadedOnly) return false;
    if(provider.kind==='hadith' && !this.showHadith) return false;
    if(provider.kind==='quran' && !this.showQuran && !this.showQuranTranslation) return false;
    return !query || `${provider.id} ${provider.name}`.toLocaleLowerCase('en-US').includes(query);
  }

  private render():void {
    const query=this.searchInput?.value.trim().toLocaleLowerCase('en-US') ?? '';
    const matches=this.definitions.filter(def=>this.matches(def,query))
      .sort((a,b)=>`${a.providerId}:${a.label}`.localeCompare(`${b.providerId}:${b.label}`));
    const matchingProviderIds=new Set(matches.map(def=>def.providerId));
    const emptyProviders=this.providers.filter(provider=>
      !matchingProviderIds.has(provider.id) && this.providerMatches(provider,query) &&
      !this.definitions.some(def=>def.providerId===provider.id)
    ).sort((a,b)=>a.name.localeCompare(b.name));

    this.listEl.empty();
    const visible=query || matches.length<=120 ? matches : matches.slice(0,120);
    const total=matches.length+emptyProviders.length;
    this.statusEl.setText(query || total<=120
      ? `${total} offline database${total===1?'':'s'} / provider${total===1?'':'s'}`
      : `Showing 120 of ${total} offline databases. Search to find a specific database.`);

    for(const provider of emptyProviders){
      const row=this.listEl.createDiv({cls:'qhf-offline-row qhf-offline-unavailable'});
      const info=row.createDiv({cls:'qhf-offline-info'});
      info.createEl('div',{text:provider.name,cls:'qhf-offline-label'});
      info.createEl('div',{text:'No downloadable offline database is currently implemented for this provider.',cls:'qhf-offline-description'});
      info.createEl('div',{text:provider.id,cls:'qhf-offline-provider'});
    }

    if(!visible.length && !emptyProviders.length){
      this.listEl.createDiv({text:'No matching offline databases.'});
      return;
    }

    for(const definition of visible){
      const row=this.listEl.createDiv({cls:'qhf-offline-row'});
      const info=row.createDiv({cls:'qhf-offline-info'});
      info.createEl('div',{text:definition.label,cls:'qhf-offline-label'});
      info.createEl('div',{text:definition.description,cls:'qhf-offline-description'});
      info.createEl('div',{text:definition.providerId,cls:'qhf-offline-provider'});
      if(this.states.has(definition.id)){
        if(definition.parts.length){
          const reinstall=row.createEl('button',{text:'Reinstall'});
          reinstall.onclick=()=>void this.install(definition,reinstall);
        }
        const remove=row.createEl('button',{text:'Remove'});
        remove.onclick=()=>void this.remove(definition,remove);
      }else{
        const install=row.createEl('button',{text:'Install'});
        install.onclick=()=>void this.install(definition,install);
      }
    }
  }

  private setLoadingButton(button:HTMLButtonElement,label:string):HTMLSpanElement {
    button.empty();
    setIcon(button,'loader-circle');
    const icon=button.querySelector('svg');
    if(icon) icon.addClass('qhf-loading-icon');
    return button.createSpan({text:label,cls:'qhf-loading-label'});
  }

  private async install(definition:OfflineDatabaseDefinition,button:HTMLButtonElement):Promise<void>{
    button.disabled=true;
    button.setAttribute('aria-busy','true');
    button.setAttribute('aria-label',`Installing ${definition.label}`);
    const label=this.setLoadingButton(button,'0%');
    const controller=new AbortController();
    this.controllers.add(controller);
    try{
      const installed=await this.onInstall(definition,controller.signal,progress=>{
        const percent=progress.total>0 ? Math.round((progress.completed/progress.total)*100) : 0;
        label.setText(`${percent}% (${progress.completed}/${progress.total})`);
      });
      this.states.set(installed.id,installed);
      new Notice(`Installed ${definition.label} for offline use.`);
    }catch(error){
      new Notice(error instanceof Error?error.message:'Offline database installation failed.');
    }finally{
      this.controllers.delete(controller);
      this.render();
    }
  }

  private async remove(definition:OfflineDatabaseDefinition,button:HTMLButtonElement):Promise<void>{
    button.disabled=true;
    button.setAttribute('aria-label',`Removing ${definition.label}`);
    button.setAttribute('aria-busy','true');
    this.setLoadingButton(button,'Removing…');
    try{
      await this.onRemove(definition.id);
      this.states.delete(definition.id);
      new Notice(`Removed ${definition.label}.`);
    }catch(error){
      new Notice(error instanceof Error?error.message:'Offline database removal failed.');
    }finally{
      button.disabled=false;
      button.removeAttribute('aria-busy');
      this.render();
    }
  }

  override onClose():void {
    for (const controller of this.controllers) controller.abort();
    this.controllers.clear();
    this.contentEl.empty();
  }
}
