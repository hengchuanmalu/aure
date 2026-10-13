import { cancelMaintenance } from '@/infrastructure/catalog-maintenance';
import { useData } from '@/state/data-context';
import { useEffect, useRef, useState } from 'react';

/** A native plan belongs to its preview, including plans that arrive after unmount. */
export function useMaintenancePreview<T extends { token: string }>(owner = '') {
  const { notice } = useData();
  const [preview, setPreview] = useState<T>();
  const alive = useRef(true);
  const generation = useRef(0);
  const token = useRef<string | undefined>(undefined);
  const committing = useRef(new Map<string, Promise<void>>());
  const releasing = useRef(new Set<string>());
  const release = (value?: string) => {
    if (!value || releasing.current.has(value)) return;
    releasing.current.add(value);
    void (async () => {
      try {
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            await cancelMaintenance(value);
            return;
          } catch {
            if (attempt === 2) notice('临时预览清理失败，请检查磁盘连接或文件占用');
            else await new Promise(resolve => setTimeout(resolve, 150 * (attempt + 1)));
          }
        }
      } finally {
        releasing.current.delete(value);
      }
    })();
  };
  useEffect(() => {
    alive.current = true;
    generation.current++;
    setPreview(undefined);
    return () => {
      alive.current = false;
      generation.current++;
      const previous = token.current;
      token.current = undefined;
      // A confirmed write may finish after navigation. Its completion owns
      // consumption; a failed write then releases the abandoned plan below.
      if (previous && !committing.current.has(previous)) release(previous);
    };
  }, [owner]);

  const prepare = async (read: () => Promise<T | null>) => {
    const request = ++generation.current;
    let result: T | null;
    try {
      result = await read();
    } catch (reason) {
      if (alive.current && request === generation.current) throw reason;
      return null;
    }
    if (!alive.current || request !== generation.current) {
      release(result?.token);
      return null;
    }
    if (result) {
      if (token.current !== result.token) release(token.current);
      token.current = result.token;
      setPreview(result);
    }
    return result;
  };
  const cancel = () => {
    generation.current++;
    const previous = token.current;
    token.current = undefined;
    if (alive.current) setPreview(undefined);
    if (previous && !committing.current.has(previous)) release(previous);
  };
  const commit = (write: (value: string) => Promise<void>): Promise<void> => {
    const selected = token.current;
    if (!selected) return Promise.reject(Error('预览已关闭，请重新选择'));
    const pending = committing.current.get(selected);
    if (pending) return pending;
    const job = (async () => {
      let completed = false;
      try {
        await Promise.resolve().then(() => write(selected));
        completed = true;
        if (token.current === selected) {
          token.current = undefined;
          if (alive.current) setPreview(undefined);
        }
      } finally {
        committing.current.delete(selected);
        if (!completed && (!alive.current || token.current !== selected)) release(selected);
      }
    })();
    committing.current.set(selected, job);
    return job;
  };
  return { preview, prepare, cancel, commit };
}
