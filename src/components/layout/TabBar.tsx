import React, { useState } from 'react';
import { X } from 'lucide-react';
import { useTabs } from '../../contexts/TabsContext';

const TabBar: React.FC = () => {
  const { tabs, activeTabId, activateTab, requestCloseTab, reorderTab } = useTabs();
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const handleCloseTab = (event: React.MouseEvent, id: string) => {
    event.stopPropagation();
    // Async: se a aba tiver dados nao salvos, pergunta antes de fechar
    // (ver useUnsavedChangesGuard) -- nada aqui precisa aguardar o
    // resultado, o proprio requestCloseTab decide o que fazer.
    requestCloseTab(id);
  };

  const handleDragStart = (id: string) => {
    setDraggedId(id);
  };

  const handleDragOver = (event: React.DragEvent, id: string) => {
    event.preventDefault();
    if (id !== dragOverId) setDragOverId(id);
  };

  const handleDrop = (event: React.DragEvent, id: string) => {
    event.preventDefault();
    if (draggedId && draggedId !== id) reorderTab(draggedId, id);
    setDraggedId(null);
    setDragOverId(null);
  };

  const handleDragEnd = () => {
    setDraggedId(null);
    setDragOverId(null);
  };

  return (
    <div className="tab-bar" role="tablist" aria-label="Telas abertas">
      {tabs.map((tab) => {
        const classNames = ['tab-bar-item'];
        if (tab.id === activeTabId) classNames.push('active');
        if (tab.id === draggedId) classNames.push('dragging');
        if (tab.id === dragOverId && tab.id !== draggedId) classNames.push('drag-over');

        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={tab.id === activeTabId}
            className={classNames.join(' ')}
            draggable
            onClick={() => activateTab(tab.id)}
            onDragStart={() => handleDragStart(tab.id)}
            onDragOver={(event) => handleDragOver(event, tab.id)}
            onDrop={(event) => handleDrop(event, tab.id)}
            onDragEnd={handleDragEnd}
          >
            <span className="tab-bar-label">{tab.label}</span>
            {tabs.length > 1 && (
              <span
                className="tab-bar-close"
                role="button"
                aria-label={`Fechar aba ${tab.label}`}
                onClick={(event) => handleCloseTab(event, tab.id)}
              >
                <X size={13} />
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
};

export default TabBar;
