import { App, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';
import type { ProviderHealth } from '../domain/provider';
import type { Settings } from '../settings/model';
import type { ReplacementRule } from '../core/normalization';
import type { TranslationDefinition } from '../domain/models';
import type { InstalledOfflineDatabase, OfflineDatabaseDefinition, OfflineInstallProgress } from '../domain/offline';
import { languageName } from '../core/languages';
import { formatScholarName } from '../core/names';
import { QURAN_WEBSITES, validateTemplate } from '../core/url';
import { CommandVisibilityModal, OfflineDatabaseModal, ReplacementRuleModal } from './modals';
import { COMMAND_DEFINITIONS } from '../core/commands';

const QURAN_PROVIDERS = {'alquran-cloud':'Al Quran Cloud','quran-unlocked':'Quran Unlocked','quran-api':'Quran API','quran-project':'Quran Project API'};
const HADITH_PROVIDERS = {'hadith-api':'hadith-api','hadith-unlocked':'Hadith Unlocked','hadith-json':'Hadith JSON'};

export class FetcherSettingTab extends PluginSettingTab {
  private displayToken=0;
  private pendingScrollPosition:{top:number;left:number}|undefined;
  private readonly translationCache=new Map<string,TranslationDefinition[]>();

  constructor(
    app:App,
    private readonly plugin:Plugin & {
      settings:Settings;
      saveSettings():Promise<void>;
      listQuranTranslations(providerId:string, signal?:AbortSignal):Promise<TranslationDefinition[]>;
      listHadithTranslations(providerId:string, signal?:AbortSignal):Promise<TranslationDefinition[]>;
      listOfflineDatabases(signal?:AbortSignal):Promise<OfflineDatabaseDefinition[]>;
      getQuranProviderSummaries():{id:string;name:string;url:string;kind:'quran'}[];
      getHadithProviderSummaries():{id:string;name:string;url:string;kind:'hadith'}[];
      listInstalledOfflineDatabases():Promise<InstalledOfflineDatabase[]>;
      installOfflineDatabase(definition:OfflineDatabaseDefinition, signal:AbortSignal, onProgress?:(progress:OfflineInstallProgress)=>void):Promise<InstalledOfflineDatabase>;
      removeOfflineDatabase(databaseId:string):Promise<void>;
    },
    private readonly healthChecks:()=>Promise<ProviderHealth[]>,
  ) { super(app, plugin); }

  /**
   * Rebuild the settings view from current plugin state. `displayToken` invalidates
   * stale asynchronous translation results, while the scroll snapshot/restore path
   * below prevents a harmless refresh from jumping the user back to the top of a long
   * settings page.
   */
  override display():void {
    const token=++this.displayToken;
    const {containerEl}=this;
    containerEl.empty();
    containerEl.createEl('h2',{text:'Quran & Hadith Fetcher'});
    this.renderSectionHeading(containerEl,'Provider Settings for Quran & Hadith','');
    this.renderProvidersSection(containerEl,token);

    this.renderSectionHeading(containerEl,'Auto-Formatting Settings','Control exactly how fetched Quran and Hadith content is displayed and inserted, including links, numbering, callouts, and punctuation handling.');
    this.renderFormattingSection(containerEl);

    this.renderSectionHeading(containerEl,'Text Conversion Settings','Optionally standardize common Islamic text variants after fetching, including salutations, Sahaba honorifics, transliteration, and your custom replacement rules.');
    this.renderTextConversionSection(containerEl);

    const pending=this.pendingScrollPosition;
    if(pending){
      const restore=()=>{
        const host=this.getSettingsScrollHost();
        host.scrollTop=pending.top;
        host.scrollLeft=pending.left;
      };
      requestAnimationFrame(()=>{
        restore();
        requestAnimationFrame(()=>restore());
      });
      window.setTimeout(()=>{
        restore();
        if(this.pendingScrollPosition===pending) this.pendingScrollPosition=undefined;
      },500);
    }
  }

  private renderSectionHeading(containerEl:HTMLElement,text:string,description:string):void {
    const heading=containerEl.createDiv({cls:'qhf-settings-section-heading'});
    heading.createEl('h3',{text});
    if(description) heading.createEl('div',{text:description,cls:'qhf-settings-section-description'});
  }

  private renderProvidersSection(containerEl:HTMLElement,token:number):void {
    new Setting(containerEl)
      .setName('Quran content provider')
      .setDesc("Choose the online project used to retrieve Quran Arabic text and translations. The provider project URL is shown for reference. URL: " + (this.plugin.getQuranProviderSummaries().find(p=>p.id===this.plugin.settings.quranProvider)?.url ?? 'Unknown'))
      .addDropdown(d=>d
        .addOptions(QURAN_PROVIDERS)
        .setValue(this.plugin.settings.quranProvider)
        .onChange(async v=>{
          this.plugin.settings.quranProvider=v;
          if(v==='alquran-cloud'){ this.plugin.settings.quranLanguage='en'; this.plugin.settings.quranTranslation='en.hilali'; }
          else if(v==='quran-unlocked'){ this.plugin.settings.quranLanguage='en'; this.plugin.settings.quranTranslation='hilali-khan'; }
          else if(v==='quran-api'){ this.plugin.settings.quranLanguage='en'; this.plugin.settings.quranTranslation='eng-muhammadtaqiudd'; }
          else if(v==='quran-project'){ this.plugin.settings.quranLanguage='en'; this.plugin.settings.quranTranslation='en'; }
          await this.plugin.saveSettings();
          this.display();
        }));
    void this.renderQuranTranslationSelectors(containerEl,this.plugin.settings.quranProvider,token);

    new Setting(containerEl)
      .setName('Quran link website')
      .addDropdown(d=>d
        .addOptions({...QURAN_WEBSITES,custom:'Custom'})
        .setValue(this.plugin.settings.quranWebsite)
        .onChange(async v=>{
          this.plugin.settings.quranWebsite=v as Settings['quranWebsite'];
          await this.plugin.saveSettings();
          this.display();
        }));

    if(this.plugin.settings.quranWebsite==='custom'){
      new Setting(containerEl)
        .setName('Custom Quran link template')
        .setDesc('Use $surah, $ayah, and $ayahlast in the URL template.')
        .addTextArea(t=>{
          t.setValue(this.plugin.settings.customQuranUrl);
          t.inputEl.rows=4;
          t.inputEl.addClass('qhf-url-template');
          t.onChange(async v=>{
            this.plugin.settings.customQuranUrl=v;
            const bad=validateTemplate(v);
            t.inputEl.toggleClass('qhf-invalid',bad.length>0);
            if(!bad.length) await this.plugin.saveSettings();
          });
        });
    }

    new Setting(containerEl)
      .setName('Hadith content provider')
      .setDesc('Choose the online project used to retrieve Hadith text, translations, and grading where supported. The provider project URL is shown for reference. URL: ' + (this.plugin.getHadithProviderSummaries().find(p=>p.id===this.plugin.settings.hadithProvider)?.url ?? 'Unknown'))
      .addDropdown(d=>d
        .addOptions(HADITH_PROVIDERS)
        .setValue(this.plugin.settings.hadithProvider)
        .onChange(async v=>{
          this.plugin.settings.hadithProvider=v;
          // Provider switches should always land on a valid English default.
          if(v==='hadith-api'){
            this.plugin.settings.hadithLanguage='en';
            this.plugin.settings.hadithTranslation='eng';
          } else if(v==='hadith-unlocked'){
            this.plugin.settings.hadithLanguage='en';
            this.plugin.settings.hadithTranslation='en';
          } else if(v==='hadith-json'){
            this.plugin.settings.hadithLanguage='en';
            this.plugin.settings.hadithTranslation='en';
          }
          await this.plugin.saveSettings();
          this.display();
        }));
    void this.renderHadithTranslationSelector(containerEl,this.plugin.settings.hadithProvider,token);

    new Setting(containerEl)
      .setName('Cache fetched content')
      .setDesc('Reuse previously fetched content before making a network request.')
      .addToggle(t=>t.setValue(this.plugin.settings.cacheEnabled).onChange(async v=>{
        this.plugin.settings.cacheEnabled=v;
        await this.plugin.saveSettings();
      }));

    this.renderFetchLimitSetting(containerEl,'Maximum Quran ayahs per fetch','Maximum ayahs requested by one Fetch Quran operation.', 'quranFetchLimit');
    this.renderFetchLimitSetting(containerEl,'Maximum Hadith per fetch','Maximum Hadith requested by one Fetch Hadith operation.', 'hadithFetchLimit');

    new Setting(containerEl)
      .setName('Offline databases')
      .setDesc('Install Quran or Hadith datasets for offline fetching.')
      .addButton(b=>b.setButtonText('Manage').onClick(async()=>{
        b.setDisabled(true);
        try {
          const [definitions,installed]=await Promise.all([this.plugin.listOfflineDatabases(),this.plugin.listInstalledOfflineDatabases()]);
          const providers=[
            ...this.plugin.getQuranProviderSummaries(),
            ...this.plugin.getHadithProviderSummaries(),
          ];
          new OfflineDatabaseModal(this.app,definitions,installed,providers,
            async(definition,signal,progress)=>this.plugin.installOfflineDatabase(definition,signal,progress),
            async(databaseId)=>this.plugin.removeOfflineDatabase(databaseId),
          ).open();
        } catch(error) { new Notice(error instanceof Error ? error.message : 'Could not load offline databases.'); }
        finally { b.setDisabled(false); }
      }));

    new Setting(containerEl)
      .setName('Check provider health')
      .setDesc('Test whether the configured providers are reachable.')
      .addButton(b=>b.setButtonText('Check now').onClick(async()=>{
        b.setDisabled(true);
        new Notice('Checking provider health…');
        try{
          for(const result of await this.healthChecks()){
            new Notice(result.ok
              ? `SUCCESS: ${result.providerId} is reachable!`
              : `ERROR: ${result.message ?? `HTTP Code ${result.status ?? 'unknown'}`}`);
          }
        } finally { b.setDisabled(false); }
      }));

    new Setting(containerEl)
      .setName('Command palette commands')
      .setDesc('Choose which plugin commands appear in Obsidian’s command palette.')
      .addButton(b=>b.setButtonText('Configure').onClick(()=>{
        const items=COMMAND_DEFINITIONS.map(command=>({id:command.id,name:command.name,enabled:this.plugin.settings.commandVisibility[command.id] !== false}));
        new CommandVisibilityModal(this.app,items,async enabled=>{
          this.plugin.settings.commandVisibility={...this.plugin.settings.commandVisibility,...enabled} as Settings['commandVisibility'];
          await this.plugin.saveSettings();
        }).open();
      }));
  }

  private renderFetchLimitSetting(containerEl:HTMLElement,name:string,description:string,key:'quranFetchLimit'|'hadithFetchLimit'):void {
    new Setting(containerEl)
      .setName(name)
      .setDesc(description)
      .addText(t=>{
        t.setValue(String(this.plugin.settings[key]));
        t.inputEl.type='number';
        t.inputEl.min='1';
        t.inputEl.max='1000';
        t.inputEl.step='1';
        t.onChange(async value=>{
          const number=Number(value);
          const valid=Number.isInteger(number) && number>=1 && number<=1000;
          t.inputEl.toggleClass('qhf-invalid',!valid);
          if(valid){
            this.plugin.settings[key]=number;
            await this.plugin.saveSettings();
          }
        });
      });
  }

  /**
   * Load translation metadata asynchronously, but render it only if this display
   * instance is still current. Without the token check, a slower provider response
   * could overwrite controls after the user has already selected another provider.
   */
  private async renderQuranTranslationSelectors(containerEl:HTMLElement,providerId:string,token:number):Promise<void>{
    const languageSetting=new Setting(containerEl).setName('Quran translation language');
    const translationSetting=new Setting(containerEl).setName('Quran translation').setDesc('Choose the specific translation inserted alongside Arabic Quran text. Available translations depend on the selected provider and language. Recommended: Hilali-Khan for English.');
    let languageSelect!:HTMLSelectElement;
    let translationSelect!:HTMLSelectElement;
    languageSetting.addDropdown(d=>{languageSelect=d.selectEl;d.addOption('','Loading…').setValue('');});
    translationSetting.addDropdown(d=>{translationSelect=d.selectEl;d.addOption('','Loading…').setValue('');});

    try{
      const translations=await this.getTranslations('quran',providerId);
      if(token!==this.displayToken)return;
      const groups=[...new Map(translations.map(t=>[t.language.toLowerCase(),t.language])).entries()]
        .sort((a,b)=>languageName(a[0]).localeCompare(languageName(b[0])));
      const storedLang=this.plugin.settings.quranLanguage.toLowerCase();
      const storedTranslation=this.plugin.settings.quranTranslation;
      const selectedTranslation=translations.find(t=>t.id===storedTranslation);
      const initial=groups.find(([code])=>code===storedLang)?.[0]
        ?? selectedTranslation?.language.toLowerCase()
        ?? 'en';

      languageSelect.replaceChildren(...groups.map(([code])=>new Option(languageName(code),code)));
      languageSelect.value=groups.some(([code])=>code===initial) ? initial : (groups[0]?.[0] ?? '');

      const renderTranslations=(lang:string,preferred:string):void=>{
        let matches=translations.filter(t=>t.language.toLowerCase()===lang.toLowerCase());
        if(lang.toLowerCase()==='ur') matches=[...matches].sort((a,b)=>{
          const aJun=/junagar/iu.test(`${a.id} ${a.name} ${a.author ?? ''}`);
          const bJun=/junagar/iu.test(`${b.id} ${b.name} ${b.author ?? ''}`);
          if(aJun!==bJun)return aJun ? -1 : 1;
          return (a.author ?? a.name).localeCompare(b.author ?? b.name);
        });
        translationSelect.replaceChildren(...matches.map(t=>new Option(formatScholarName(t.author ?? t.name),t.id)));
        const chosen=matches.find(t=>t.id===preferred)
          ?? (lang.toLowerCase()==='ur' ? matches.find(t=>/junagar/iu.test(`${t.id} ${t.name} ${t.author ?? ''}`)) : undefined)
          ?? (lang.toLowerCase()==='en' ? matches.find(t=>t.id==='hilali-khan' || t.id==='en.hilali') : undefined)
          ?? matches[0];
        if(!chosen)return;
        translationSelect.value=chosen.id;
        this.plugin.settings.quranLanguage=chosen.language;
        this.plugin.settings.quranTranslation=chosen.id;
      };

      renderTranslations(languageSelect.value,storedTranslation);
      languageSelect.onchange=async()=>{
        renderTranslations(languageSelect.value,'');
        await this.plugin.saveSettings();
      };
      translationSelect.onchange=async()=>{
        const chosen=translations.find(t=>t.id===translationSelect.value);
        if(!chosen)return;
        this.plugin.settings.quranLanguage=chosen.language;
        this.plugin.settings.quranTranslation=chosen.id;
        await this.plugin.saveSettings();
      };
    } catch {
      if(token!==this.displayToken)return;
      languageSelect.replaceChildren(new Option('Unavailable',''));
      translationSelect.replaceChildren(new Option('Unavailable',''));
    }
  }

  private async renderHadithTranslationSelector(containerEl:HTMLElement,providerId:string,token:number):Promise<void>{
    const setting=new Setting(containerEl).setName('Hadith translation');
    let select!:HTMLSelectElement;
    setting.addDropdown(d=>{select=d.selectEl;d.addOption('','Loading…').setValue('');});
    try{
      const translations=await this.getTranslations('hadith',providerId);
      if(token!==this.displayToken)return;
      const currentId=this.plugin.settings.hadithTranslation;
      const currentLang=this.plugin.settings.hadithLanguage.toLowerCase();
      const english=translations.find(t=>t.language.toLowerCase()==='en');
      const chosen=translations.find(t=>t.id===currentId && t.language.toLowerCase()===currentLang)
        ?? translations.find(t=>t.id===currentId)
        ?? english
        ?? translations[0];
      if(!chosen)return;

      const optionLabel=(t:TranslationDefinition)=>{
        const lang=languageName(t.language);
        return t.name===lang ? lang : `${lang} — ${t.name}`;
      };
      const options=translations.map(t=>({value:`${t.language.toLowerCase()}\u0000${t.id}`,label:optionLabel(t)}));
      select.replaceChildren(...options.map(o=>new Option(o.label,o.value)));
      select.value=`${chosen.language.toLowerCase()}\u0000${chosen.id}`;
      this.plugin.settings.hadithLanguage=chosen.language;
      this.plugin.settings.hadithTranslation=chosen.id;

      select.onchange=async()=>{
        const [language,id]=select.value.split('\u0000');
        const item=translations.find(t=>t.id===id && t.language.toLowerCase()===language);
        if(!item)return;
        this.plugin.settings.hadithLanguage=item.language;
        this.plugin.settings.hadithTranslation=item.id;
        await this.plugin.saveSettings();
      };
    } catch {
      if(token!==this.displayToken)return;
      select.replaceChildren(new Option('Unavailable',''));
    }
  }

  private async getTranslations(kind:'quran'|'hadith',providerId:string):Promise<TranslationDefinition[]>{
    const key=`${kind}:${providerId}`;
    const cached=this.translationCache.get(key);
    if(cached)return cached.map(x=>({...x}));
    const translations=await (kind==='quran'
      ? this.plugin.listQuranTranslations(providerId)
      : this.plugin.listHadithTranslations(providerId));
    this.translationCache.set(key,translations.map(x=>({...x})));
    return translations.map(x=>({...x}));
  }

  private renderFormattingSection(containerEl:HTMLElement):void {
    new Setting(containerEl).setName('Use Arabic-Indic ayah numbers').setDesc('Show Quran ayah numbers with Arabic-Indic digits (١، ٢، ٣) instead of Western digits (1, 2, 3) in inserted output.')
      .addToggle(t=>t.setValue(this.plugin.settings.formatting.arabicAyahNumbers).onChange(async v=>{
        this.plugin.settings.formatting.arabicAyahNumbers=v;
        await this.plugin.saveSettings();
      }));

    this.renderBracketSetting(containerEl,'Ayah number brackets',this.currentAyahBracketStyle(),'ayahNumberStyle','Choose the opening and closing characters placed around visible ayah numbers in inserted output.',{
      angle:['⟪','⟫'],square:['[',']'],round:['(',')'],curly:['{','}'],heavyAngle:['❰','❱'],ceiling:['⌈','⌉'],floor:['⌊','⌋'],heavyAngleAlt:['❮','❯'],lenticular:['〖','〗'],
    },'ayahNumberOpen','ayahNumberClose','ayahNumberStyle');

    this.renderBracketSetting(containerEl,'Quran Ayah brackets',this.currentQuranAyahStyle(),'quranAyahStyle','Choose the opening and closing characters placed around Quran ayah references when reference formatting is enabled.',{
      curly:['{','}'],square:['[',']'],round:['(',')'],angle:['⟪','⟫'],heavyAngle:['❰','❱'],ceiling:['⌈','⌉'],floor:['⌊','⌋'],heavyAngleAlt:['❮','❯'],lenticular:['〖','〗'],
    },'quranAyahOpen','quranAyahClose','quranAyahStyle');

    new Setting(containerEl)
      .setName('Handle code-like apostrophes')
      .setDesc('Choose how backticks in inserted Quran and Hadith text are handled, so transliteration marks do not look like Markdown code syntax.')
      .addDropdown(d=>d
        .addOptions({
          replace:'Replace ` with ʿ',
          remove:'Remove `',
          none:'Do not modify',
        })
        .setValue(this.plugin.settings.formatting.codeSyntaxMode)
        .onChange(async v=>{
          this.plugin.settings.formatting.codeSyntaxMode=v as Settings['formatting']['codeSyntaxMode'];
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl).setName('Callout style').setDesc('Choose the Obsidian callout used to wrap fetched Quran or Hadith content. Select None for plain Markdown without a callout.').addDropdown(d=>d.addOptions({
      none:'None',quote:'Quote',note:'Note',abstract:'Abstract',info:'Info',todo:'Todo',tip:'Tip',success:'Success',question:'Question',warning:'Warning',failure:'Failure',danger:'Danger',bug:'Bug',example:'Example',cite:'Cite',custom:'Custom'
    }).setValue(this.plugin.settings.formatting.callout).onChange(async v=>{
      this.plugin.settings.formatting.callout=v as Settings['formatting']['callout'];
      await this.plugin.saveSettings();
      this.display();
    }));
    if(this.plugin.settings.formatting.callout==='custom'){
      new Setting(containerEl).setName('Custom callout type').setDesc('Enter the Obsidian callout type used when Callout style is Custom. Enter the type only, without the [!] marker; for example, my-callout.').addText(t=>t.setValue(this.plugin.settings.formatting.customCalloutType).onChange(async v=>{
        this.plugin.settings.formatting.customCalloutType=v.trim();
        await this.plugin.saveSettings();
      }));
    }
  }

  private renderBracketSetting(
    containerEl:HTMLElement,
    name:string,
    current:string,
    _styleKey:string,
    description:string,
    presets:{[key:string]:[string,string]},
    openKey:'ayahNumberOpen'|'quranAyahOpen',
    closeKey:'ayahNumberClose'|'quranAyahClose',
    styleKey:'ayahNumberStyle'|'quranAyahStyle',
  ):void{
    new Setting(containerEl).setName(name).setDesc(description).addDropdown(d=>d
      .addOptions({...Object.fromEntries(Object.entries(presets).map(([k,[open,close]])=>[k,`${open}${close}`])),custom:'Custom'})
      .setValue(current)
      .onChange(async v=>{
        (this.plugin.settings.formatting as unknown as Record<string,unknown>)[styleKey]=v;
        if(v!=='custom'){
          const [open,close]=presets[v]!;
          (this.plugin.settings.formatting as unknown as Record<string,unknown>)[openKey]=open;
          (this.plugin.settings.formatting as unknown as Record<string,unknown>)[closeKey]=close;
        }
        await this.plugin.saveSettings();
        this.display();
      }));

    if(current==='custom'){
      new Setting(containerEl).setName(`${name} opening`).setDesc('Character placed before the formatted value.').addText(t=>t.setValue(this.plugin.settings.formatting[openKey]).onChange(async v=>{
        this.plugin.settings.formatting[openKey]=v;
        await this.plugin.saveSettings();
      }));
      new Setting(containerEl).setName(`${name} closing`).setDesc('Character placed after the formatted value.').addText(t=>t.setValue(this.plugin.settings.formatting[closeKey]).onChange(async v=>{
        this.plugin.settings.formatting[closeKey]=v;
        await this.plugin.saveSettings();
      }));
    }
  }

  private getSettingsScrollHost():HTMLElement {
    const verticalTabContent=this.containerEl.closest('.vertical-tab-content') as HTMLElement | null;
    if(verticalTabContent) return verticalTabContent;

    const candidates=this.getSettingsScrollElements();
    const scrollable=candidates.find(el=>el.scrollHeight>el.clientHeight || el.scrollWidth>el.clientWidth);
    return scrollable ?? this.containerEl;
  }

  private getSettingsScrollElements():HTMLElement[] {
    const elements:HTMLElement[]=[];
    const seen=new Set<HTMLElement>();
    let el:HTMLElement|null=this.containerEl;
    while(el){
      if(!seen.has(el)){
        seen.add(el);
        elements.push(el);
      }
      el=el.parentElement;
    }
    if(document.scrollingElement instanceof HTMLElement && !seen.has(document.scrollingElement)){
      elements.push(document.scrollingElement);
    }
    return elements;
  }

  private captureSettingsScroll():Array<{element:HTMLElement;top:number;left:number}> {
    const host=this.getSettingsScrollHost();
    const candidates=this.getSettingsScrollElements();
    const elements=[host,...candidates.filter(el=>el!==host)];
    return elements
      .filter(el=>el.scrollTop>0 || el.scrollLeft>0 || el===host)
      .map(element=>({element,top:element.scrollTop,left:element.scrollLeft}));
  }

  private restoreSettingsScroll(positions:Array<{element:HTMLElement;top:number;left:number}>):void {
    for(const position of positions){
      position.element.scrollTop=position.top;
      position.element.scrollLeft=position.left;
    }
  }

  /**
   * Preserve every relevant settings scroll container during a setting save. Obsidian uses
   * `.vertical-tab-content` on desktop, while some layouts (including mobile) can scroll a
   * higher-level container. Capture the full ancestor chain instead of assuming one host.
   */
  private preserveSettingsScroll<T>(action:()=>T|Promise<T>):Promise<T> {
    const positions=this.captureSettingsScroll();
    const active=document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const restore=()=>{
      this.restoreSettingsScroll(positions);
      if(active?.isConnected){
        try { active.focus({preventScroll:true}); } catch { active.focus(); }
      }
    };
    this.pendingScrollPosition=positions[0] ? {top:positions[0].top,left:positions[0].left} : undefined;
    // Do not call display() here. The settings DOM should not be rebuilt merely because
    // this toggle changed; only restore the scroll/focus if Obsidian itself causes a relayout.
    restore();
    return Promise.resolve(action()).finally(()=>{
      restore();
      requestAnimationFrame(()=>{
        restore();
        requestAnimationFrame(()=>{
          restore();
          window.setTimeout(restore,50);
          window.setTimeout(restore,200);
          window.setTimeout(restore,500);
        });
      });
    });
  }

  /**
   * Rebuild only the conversion-rule portion of the settings while preserving the
   * current settings scroll position. Callers use this after adding, editing, or
   * deleting a custom conversion rule.
   */
  // Rule-list changes require a redraw because rows are created/removed. The master
  // Text Conversions toggle is different: it updates existing DOM state in place and
  // must not call this redraw path, otherwise Obsidian can reset the settings scroll.
  private refreshAfterRuleChange():void {
    const positions=this.captureSettingsScroll();
    const first=positions[0];
    this.pendingScrollPosition=first ? {top:first.top,left:first.left} : undefined;
    this.display();
  }

  private renderTextConversionSection(containerEl:HTMLElement):void {
    const conversionsEnabled=this.plugin.settings.textConversionsEnabled === true;
    let controls!:HTMLDivElement;

    new Setting(containerEl)
      .setName('Toggle Text Conversions')
      .setDesc('Enable or disable every automatic text conversion applied after fetching. Rule settings remain editable while this master switch is off, but their conversions are not applied.')
      .addToggle(t=>t.setValue(conversionsEnabled).onChange(async v=>{
        const enabled=v === true;
        await this.preserveSettingsScroll(async()=>{
          // IMPORTANT: this is intentionally NOT inverted. ON means enabled; OFF means disabled.
          // Keep this mapping identical to Settings.textConversionsEnabled and createNormalizers().
          this.plugin.settings.textConversionsEnabled=enabled;
          controls.toggleClass('qhf-text-conversions-disabled',!enabled);
          controls.setAttribute('aria-disabled',String(!enabled));
          await this.plugin.saveSettings();
        });
      }));

    controls=containerEl.createDiv({cls:`qhf-text-conversion-controls${conversionsEnabled ? '' : ' qhf-text-conversions-disabled'}`,attr:{'aria-disabled':String(!conversionsEnabled)}});

    const blessingSetting=new Setting(controls)
      .setName('Normalize salutations to ﷺ')
      .setDesc('Convert common salutation variants to ﷺ. Examples: SAW, S.A.W., S.A.W.S., and P.B.U.H. → (ﷺ); (O Muhammad SAW) → (O Muhammad ﷺ); may peace and blessings be upon him → ﷺ; Prophet, may Allah bless him and grant him peace → Prophet ﷺ; صلى الله عليه وسلم → ﷺ. Existing ﷺ and source parentheses are preserved.')
      .addToggle(t=>t.setValue(this.plugin.settings.blessingNormalization).onChange(async v=>{
        this.plugin.settings.blessingNormalization=v;
        await this.plugin.saveSettings();
      }));
    blessingSetting.settingEl.addClass('qhf-setting-ltr');

    new Setting(controls)
      .setName('Convert Variants of RA used for the Sahaba to رَضِيَ اللهُ عَنْهُ')
      .setDesc('Convert English and abbreviated variants of the Sahaba honorific to Arabic. Examples: RA, R.A., R.A. → رضي اللّه عنه; (May Allah be pleased with Him) → (رضي اللّه عنه); (May Allah be pleased with Her) → (رضي اللّه عنها); (May Allah be pleased with them) → (رضي اللّه عنهم); may Allah be pleased with them → رضي اللّه عنهم; and comma forms such as “Jabir, may Allah be pleased with them,” → “Jabir رضي اللّه عنهم”.')
      .addToggle(t=>t.setValue(this.plugin.settings.raNormalization).onChange(async v=>{
        this.plugin.settings.raNormalization=v;
        await this.plugin.saveSettings();
      }));

    new Setting(controls).setName('Use standard English transliteration').setDesc('Replace selected transliteration marks with simpler English spellings. Example: Ayât → Ayat.')
      .addToggle(t=>t.setValue(this.plugin.settings.romanEnglish).onChange(async v=>{
        this.plugin.settings.romanEnglish=v;
        await this.plugin.saveSettings();
      }));

    const list=controls.createDiv({cls:'qhf-replacement-list'});
    for(const rule of this.plugin.settings.replacementRules) this.renderReplacementRule(list,rule,conversionsEnabled);

    new Setting(controls)
      .addButton(b=>b.setButtonText('Add conversion').setCta().onClick(()=>{
        const rule:ReplacementRule={
          id:`custom-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
          language:'en',title:'Custom conversion',description:'',from:'',to:'',enabled:true,caseSensitive:false,
        };
        // IMPORTANT: A new conversion is only added to settings after Save is pressed.
        // Do not push this draft into `replacementRules` before the modal is saved,
        // otherwise cancelling/escaping leaves an empty conversion behind.
        void new ReplacementRuleModal(
          this.app,
          rule,
          async draft=>{
            this.plugin.settings.replacementRules.push({...draft});
            await this.plugin.saveSettings();
            this.refreshAfterRuleChange();
          },
          async()=>{ /* A new, unsaved rule is never present in settings. */ },
          ()=>{ /* Cancel/Escape must not mutate or persist a new rule. */ },
          // Read the master toggle at modal-open time so the warning never lags behind settings.
          ()=>this.plugin.settings.textConversionsEnabled === true,
          true,
        ).open();
      }));
  }

  private renderReplacementRule(containerEl:HTMLElement,rule:ReplacementRule,conversionsEnabled=true):void{
    const card=containerEl.createDiv({cls:'qhf-replacement-rule'});
    card.toggleClass('qhf-replacement-disabled',!rule.enabled);
    card.createEl('div',{text:rule.title || 'Text conversion',cls:'qhf-replacement-title'});
    if(rule.description.trim()) card.createEl('div',{text:rule.description,cls:'qhf-replacement-description'});
    const row=card.createDiv({cls:'qhf-replacement-summary'});
    row.createEl('span',{text:rule.from || '—',cls:'qhf-replacement-term'});
    row.createEl('span',{text:'→',cls:'qhf-replacement-arrow'});
    row.createEl('span',{text:rule.to || '—',cls:'qhf-replacement-term'});
    const edit=row.createEl('button',{text:'Edit',cls:'qhf-replacement-edit',attr:{
      type:'button',
      'aria-label':'Edit conversion',
      title:'Edit conversion',
    }});
    edit.addEventListener('click',()=>{
      void new ReplacementRuleModal(
      this.app,
      rule,
      async()=>{ await this.plugin.saveSettings(); this.refreshAfterRuleChange(); },
      async()=>{ this.plugin.settings.replacementRules=this.plugin.settings.replacementRules.filter(x=>x.id!==rule.id); await this.plugin.saveSettings(); this.refreshAfterRuleChange(); },
      ()=>this.refreshAfterRuleChange(),
      // Read the master toggle at modal-open time so the warning never lags behind settings.
      ()=>this.plugin.settings.textConversionsEnabled === true,
      ).open();
    });

    const toggle=row.createEl('button',{cls:'qhf-conversion-toggle',attr:{
      type:'button',
      role:'switch',
      'aria-checked':String(rule.enabled),
      'aria-label':rule.enabled ? 'Disable conversion' : 'Enable conversion',
      title:rule.enabled ? 'Disable conversion' : 'Enable conversion',
    }});
    const syncToggle=()=>{
      toggle.setAttribute('aria-checked',String(rule.enabled));
      toggle.setAttribute('aria-label',rule.enabled ? 'Disable conversion' : 'Enable conversion');
      toggle.setAttribute('title',rule.enabled ? 'Disable conversion' : 'Enable conversion');
      toggle.toggleClass('qhf-conversion-toggle-active',rule.enabled);
      toggle.empty();
      const track=toggle.createSpan({cls:'qhf-conversion-toggle-track'});
      track.createSpan({cls:'qhf-conversion-toggle-thumb'});
      card.toggleClass('qhf-replacement-disabled',!rule.enabled);
    };
    toggle.addEventListener('click',async()=>{
      rule.enabled=!rule.enabled;
      syncToggle();
      await this.plugin.saveSettings();
    });
    syncToggle();
  }

  private currentQuranAyahStyle(): 'curly'|'square'|'round'|'angle'|'heavyAngle'|'ceiling'|'floor'|'heavyAngleAlt'|'lenticular'|'custom' {
    const stored=this.plugin.settings.formatting.quranAyahStyle;
    if(stored)return stored;
    const {quranAyahOpen:open,quranAyahClose:close}=this.plugin.settings.formatting;
    if(open==='{'&&close==='}')return 'curly';
    if(open==='['&&close===']')return 'square';
    if(open==='('&&close===')')return 'round';
    if(open==='⟪'&&close==='⟫')return 'angle';
    if(open==='❰'&&close==='❱')return 'heavyAngle';
    if(open==='⌈'&&close==='⌉')return 'ceiling';
    if(open==='⌊'&&close==='⌋')return 'floor';
    if(open==='❮'&&close==='❯')return 'heavyAngleAlt';
    if(open==='〖'&&close==='〗')return 'lenticular';
    return 'custom';
  }

  private currentAyahBracketStyle(): 'angle'|'square'|'round'|'curly'|'heavyAngle'|'ceiling'|'floor'|'heavyAngleAlt'|'lenticular'|'custom' {
    const stored=this.plugin.settings.formatting.ayahNumberStyle;
    if(stored)return stored;
    const {ayahNumberOpen:open,ayahNumberClose:close}=this.plugin.settings.formatting;
    if(open==='⟪'&&close==='⟫')return 'angle';
    if(open==='['&&close===']')return 'square';
    if(open==='('&&close===')')return 'round';
    if(open==='{'&&close==='}')return 'curly';
    return 'custom';
  }
}
