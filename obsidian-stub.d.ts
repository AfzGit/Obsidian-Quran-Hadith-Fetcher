declare module 'obsidian' {
  export interface RequestUrlParam { url:string; method?:string; throw?:boolean; }
  export interface RequestUrlResponse { status:number; text:string; headers:Record<string,string>; }
  export function requestUrl(params: RequestUrlParam): Promise<RequestUrlResponse>;
  export function normalizePath(path:string): string;
  export class App { vault:any; }
  export class Editor { getSelection():string; replaceSelection(value:string):void; replaceRange(value:string,from:any,to?:any):void; getCursor():any; getLine(line:number):string; }
  export class Plugin { app:App; manifest:any; loadData():Promise<any>; saveData(data:any):Promise<void>; addCommand(...args:any[]):any; addSettingTab(...args:any[]):any; }
  export class Notice { constructor(message:string); }
  export class PluginSettingTab { app:App; plugin:Plugin; containerEl:any; constructor(app:App,plugin:Plugin); display():void; }
  export class Setting { constructor(el:any); setName(v:string):this; setDesc(v:string):this; setDisabled(v:boolean):this; addDropdown(fn:any):this; addToggle(fn:any):this; addButton(fn:any):this; addText(fn:any):this; addTextArea(fn:any):this; }
  export class Modal { app:App; contentEl:any; titleEl:any; modalEl:any; constructor(app:App); open():void; close():void; }
  export class FuzzySuggestModal<T> extends Modal { setPlaceholder(v:string):void; getItems():T[]; getItemText(item:T):string; onChooseItem(item:T):void; }
}
