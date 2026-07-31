import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, X } from 'lucide-react';
import { useTabs, MAX_TABS_LIMIT } from '../../contexts/TabsContext';
import { showError } from '../../utils/alerts';

const TabBar: React.FC = () => {
  const { tabs, activeTabId, closeTab } = useTabs();
  const navigate = useNavigate();

  const handleAddTab = () => {
    if (tabs.length >= MAX_TABS_LIMIT) {
      showError('Limite de abas atingido', `Você pode manter no máximo ${MAX_TABS_LIMIT} abas abertas ao mesmo tempo. Feche alguma antes de abrir outra.`);
      return;
    }
    navigate('/dashboard');
  };

  const handleCloseTab = (event: React.MouseEvent, id: string) => {
    event.stopPropagation();
    closeTab(id);
  };

  return (
    <div className="tab-bar" role="tablist" aria-label="Telas abertas">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={tab.id === activeTabId}
          className={tab.id === activeTabId ? 'tab-bar-item active' : 'tab-bar-item'}
          onClick={() => navigate(tab.path)}
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
      ))}
      <button type="button" className="tab-bar-add" onClick={handleAddTab} title="Abrir nova aba">
        <Plus size={16} />
      </button>
    </div>
  );
};

export default TabBar;
