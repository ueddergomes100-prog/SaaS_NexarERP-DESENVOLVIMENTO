import React, { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { useTabs, MAX_TABS_LIMIT } from '../../contexts/TabsContext';
import { showError } from '../../utils/alerts';

const TabBar: React.FC = () => {
  const { tabs, activeTabId, activateTab, closeTab, reorderTab, openTab } = useTabs();
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const handleAddTab = () => {
    if (tabs.length >= MAX_TABS_LIMIT) {
      showError('Limite de abas atingido', `Você pode manter no máximo ${MAX_TABS_LIMIT} abas abertas ao mesmo tempo. Feche alguma antes de abrir outra.`);
      return;
    }
    openTab('/dashboard', 'Dashboard');
  };

  const handleCloseTab = (event: React.MouseEvent, id: string) => {
    event.stopPropagation();
    closeTab(id);
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
      <button type="button" className="tab-bar-add" onClick={handleAddTab} title="Abrir nova aba">
        <Plus size={16} />
      </button>
    </div>
  );
};

export default TabBar;
