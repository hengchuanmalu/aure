import { beforeEach,describe,expect,it } from 'vitest';
import { applyOperation } from "../../src/application/operations";
import { seed } from '../../src/domain/database';
import { MockRepository } from '../../src/infrastructure/mock-repository';
import { seedFixture } from "../support/demo.fixture";
const entries=new Map<string,string>();
const storage={getItem:(k:string)=>entries.get(k)??null,setItem:(k:string,v:string)=>{entries.set(k,v)},removeItem:(k:string)=>entries.delete(k),clear:()=>entries.clear(),key:(n:number)=>[...entries.keys()][n]??null,get length(){return entries.size}};


beforeEach(()=>entries.clear());
describe('repository transactions and references',()=>{
 it('starts and resets with an empty library without bundled samples',async()=>{
   const repo=new MockRepository(storage);
   expect(await repo.read()).toEqual(seed());
   expect([seed().albums,seed().media,seed().models,seed().tags,seed().groups,seed().recent]).toEqual([[],[],[],[],[],[]]);
   await repo.update(d=>Object.assign(d,seedFixture()));
   expect((await repo.read()).albums).toHaveLength(12);
   expect(await repo.reset()).toEqual(seed());
 });
 it('persists bounded history without cloning or rewriting the library, and reads it after reload',async()=>{
   storage.setItem('jingji.mock.v1',JSON.stringify(seedFixture()));
   const repo=new MockRepository(storage);const initial=await repo.read();
   const old=storage.getItem('jingji.mock.v1');
   const next=await repo.saveRecent(initial,[{albumId:'a0',mediaId:'p0',at:'2026-09-29'}]);
   expect(next.media).toBe(initial.media);expect(next.albums).toBe(initial.albums);
   expect(storage.getItem('jingji.mock.v1')).toBe(old);
   expect((await new MockRepository(storage).read()).recent).toEqual(next.recent);
   const failing=new MockRepository({...storage,setItem:(key:string,value:string)=>{if(key.endsWith('.recent'))throw Error('quota');storage.setItem(key,value)}});
   await failing.read();await expect(failing.saveRecent(next,[])).rejects.toThrow('quota');
   expect((await repo.read()).recent).toEqual(next.recent);
   await repo.saveRecent(next,[]);expect((await repo.read()).recent).toEqual([]);
 });
 it('preserves the previous database if an operation or storage write fails',async()=>{const repo=new MockRepository(storage);await repo.reset();const old=entries.get('jingji.mock.v1');await expect(repo.update(d=>{d.albums=[];throw Error('rollback')})).rejects.toThrow();expect(entries.get('jingji.mock.v1')).toBe(old);const failing=new MockRepository({...storage,setItem:()=>{throw Error('quota')}});await expect(failing.update(d=>{d.albums=[]})).rejects.toThrow('quota');expect(entries.get('jingji.mock.v1')).toBe(old)});
 it('saves profile and all album links together without duplicates',()=>{const d=seedFixture();applyOperation(d,{type:'saveModel',model:{...d.models[0],name:'测试人物'},albumIds:['a0','a1']});expect(d.models[0].name).toBe('测试人物');expect(d.albums.filter(a=>a.modelIds.includes('m0')).map(a=>a.id)).toEqual(['a0','a1']);applyOperation(d,{type:'saveModel',model:d.models[0],albumIds:['a1']});expect(d.albums[1].modelIds.filter(id=>id==='m0')).toHaveLength(1)});
 it('deleting a group preserves tags, references and original media',()=>{const d=seedFixture(),sources=d.media.map(m=>m.src);applyOperation(d,{type:'removeTag',id:'g0',group:true});expect(d.tags.some(t=>t.groupId==='g0')).toBe(false);expect([...d.albums,...d.media].some(x=>x.tags.some(t=>t.startsWith('t0')))).toBe(true);expect(d.media.map(m=>m.src)).toEqual(sources)});
 it('removing an album preserves shared media and removes recent entry',()=>{const d=seedFixture();applyOperation(d,{type:'removeAlbum',id:'a2'});expect(d.recent.some(r=>r.albumId==='a2')).toBe(false);expect(d.media).toHaveLength(14);expect(d.albums).toHaveLength(11)});
 it('rejects broken references and does not silently reset future versions',async()=>{const repo=new MockRepository(storage);await expect(repo.update(d=>applyOperation(d,{type:'saveAlbum',album:{...d.albums[0],mediaIds:['unknown']}}))).rejects.toThrow();storage.setItem('jingji.mock.v1',JSON.stringify({version:9}));await expect(repo.read()).rejects.toThrow();expect(JSON.parse(storage.getItem('jingji.mock.v1')!).version).toBe(9)});
});
