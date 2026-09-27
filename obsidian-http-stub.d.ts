declare module 'obsidian' {
  export interface RequestUrlParam { url:string; method?:string; throw?:boolean; }
  export interface RequestUrlResponse { status:number; text:string; headers:Record<string,string>; }
  export function requestUrl(params:RequestUrlParam):Promise<RequestUrlResponse>;
}
