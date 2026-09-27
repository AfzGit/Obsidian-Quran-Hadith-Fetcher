/**
 * Tracks the currently active user operation and cancels the previous one when a
 * new operation starts. This is intentionally a single-flight *UI operation*
 * mechanism, not a network cache: an older modal/command must stop updating the
 * editor after the user starts a newer command.
 */
export class OperationManager { private currentId=0; private current?:AbortController; begin():{id:number;signal:AbortSignal}{this.current?.abort();this.current=new AbortController();this.currentId+=1;return{id:this.currentId,signal:this.current.signal};} isCurrent(id:number):boolean{return id===this.currentId && !this.current?.signal.aborted;} cancel():void{this.current?.abort();this.currentId+=1;} }
