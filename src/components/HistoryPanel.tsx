import { useEffect, useState } from 'react';
import { AlertTriangle, Clock3, Trash2, X } from 'lucide-react';
import { clearHistory, deleteHistory, listHistory, type HistoryEntry } from '../lib/history';
import { bandOf } from '../lib/types';
import { formatTime } from '../lib/utils';

interface Props {
  onOpen: (entry: HistoryEntry) => void;
  onClose: () => void;
}

export function HistoryPanel({ onOpen, onClose }: Props) {
  const [items, setItems] = useState<HistoryEntry[]>(() => listHistory());
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  const refresh = () => setItems(listHistory());

  const remove = (id: string) => {
    deleteHistory(id);
    setConfirmId(null);
    refresh();
  };

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog dialog--wide" role="dialog" aria-modal="true" aria-label="核查历史">
        <div className="dialog-head">
          <div>
            <p className="eyebrow">Archive</p>
            <h2 className="dialog-title">核查历史</h2>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="关闭" type="button">
            <X size={16} />
          </button>
        </div>

        <div className="dialog-body dialog-body--flush">
          {items.length === 0 ? (
            <div className="hist-empty">
              <Clock3 size={22} strokeWidth={1.6} />
              <p>还没有核查记录。</p>
              <span>每次核查结束后都会自动存档到这台设备，最多保留 40 条。</span>
            </div>
          ) : (
            <ul className="hist-list">
              {items.map((item) => {
                const band = bandOf(item.score);
                const confirming = confirmId === item.id;
                return (
                  <li key={item.id} className="hist-item">
                    <button type="button" className="hist-main" onClick={() => onOpen(item)}>
                      <span className={`hist-score hist-score--${band.tone}`}>
                        {item.score}
                        <em>{band.label}</em>
                      </span>
                      <span className="hist-text">
                        <span className="hist-title">{item.title}</span>
                        <span className="hist-meta">
                          {item.providerName} · {item.model} · {formatTime(item.createdAt)} · {item.chars} 字
                          {item.evidence ? ` · ${item.evidence} 条证据` : ''}
                        </span>
                        {item.excerpt && <span className="hist-excerpt">{item.excerpt}</span>}
                      </span>
                    </button>
                    {confirming ? (
                      <span className="hist-confirm">
                        <button type="button" className="hist-del is-danger" onClick={() => remove(item.id)}>
                          确认删除
                        </button>
                        <button type="button" className="hist-cancel" onClick={() => setConfirmId(null)}>
                          取消
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="hist-del"
                        title="删除这条记录"
                        onClick={() => setConfirmId(item.id)}
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="dialog-foot">
          <span className="dialog-foot-note">
            {items.length ? `共 ${items.length} 条 · 只存在本机` : '本地存档'}
          </span>
          <div className="dialog-foot-right">
            {items.length > 0 &&
              (confirmClear ? (
                <>
                  <span className="hist-warn">
                    <AlertTriangle size={12} />
                    全部删除？
                  </span>
                  <button
                    type="button"
                    className="text-link text-link--danger"
                    onClick={() => {
                      clearHistory();
                      setConfirmClear(false);
                      refresh();
                    }}
                  >
                    确认清空
                  </button>
                  <button type="button" className="ghost-btn" onClick={() => setConfirmClear(false)}>
                    取消
                  </button>
                </>
              ) : (
                <button type="button" className="ghost-btn" onClick={() => setConfirmClear(true)}>
                  <Trash2 size={13} />
                  清空全部
                </button>
              ))}
            <button type="button" className="cta cta--sm" onClick={onClose}>
              关闭
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
