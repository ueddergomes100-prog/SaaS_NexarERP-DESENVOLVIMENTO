import React from 'react';
import { Calendar, Filter, User, UserCheck, Search } from 'lucide-react';

interface ReportFilterProps {
  period: string;
  setPeriod: (v: string) => void;
  startDate?: string;
  setStartDate?: (v: string) => void;
  endDate?: string;
  setEndDate?: (v: string) => void;
  onSearch?: () => void;
  extraFilters?: React.ReactNode;
}

const ReportFilter: React.FC<ReportFilterProps> = ({ 
  period, setPeriod, startDate, setStartDate, endDate, setEndDate, onSearch, extraFilters 
}) => {
  return (
    <div className="card" style={{ 
      padding: '20px', 
      backgroundColor: 'var(--bg-secondary)', 
      borderRadius: 'var(--radius-lg)',
      marginBottom: '24px'
    }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', alignItems: 'flex-end' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Período</label>
          <select 
            value={period} 
            onChange={(e) => setPeriod(e.target.value)}
            style={{ 
              backgroundColor: 'var(--bg-tertiary)', 
              border: '1px solid var(--border-color)', 
              borderRadius: 'var(--radius-md)', 
              padding: '10px 16px', 
              color: 'var(--text-primary)',
              minWidth: '150px'
            }}
          >
            <option value="hoje">Hoje</option>
            <option value="ontem">Ontem</option>
            <option value="semana">Últimos 7 dias</option>
            <option value="mes">Este Mês</option>
            <option value="ano">Este Ano</option>
            <option value="personalizado">Personalizado</option>
          </select>
        </div>

        {period === 'personalizado' && (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Data Início</label>
              <input 
                type="date" 
                value={startDate}
                onChange={(e) => setStartDate?.(e.target.value)}
                style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '10px 16px', color: 'var(--text-primary)' }}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Data Fim</label>
              <input 
                type="date" 
                value={endDate}
                onChange={(e) => setEndDate?.(e.target.value)}
                style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '10px 16px', color: 'var(--text-primary)' }}
              />
            </div>
          </>
        )}

        {extraFilters}

        <button 
          onClick={onSearch}
          className="btn-primary" 
          style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: '8px', 
            padding: '11px 24px',
            marginLeft: 'auto'
          }}
        >
          <Search size={18} /> Filtrar Resultados
        </button>
      </div>
    </div>
  );
};

export default ReportFilter;
