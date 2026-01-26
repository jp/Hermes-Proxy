import React from 'react';
import logo from '../../images/logo.png';

type SidebarProps = {
  activeTab: string;
  onTabChange: (tab: string) => void;
};

function Sidebar({ activeTab, onTabChange }: SidebarProps) {
  return (
    <aside className="sidebar">
      <img className="brand-logo" src={logo} alt="Hermes Proxy logo" />
      <button
        className={`nav-item ${activeTab === 'intercept' ? 'active' : ''}`}
        onClick={() => onTabChange('intercept')}
      >
        <span className="icon" aria-hidden="true">
          <i className="fa-solid fa-satellite-dish"></i>
        </span>
        <span className="label">Intercept</span>
      </button>
      <button
        className={`nav-item ${activeTab === 'setup' ? 'active' : ''}`}
        onClick={() => onTabChange('setup')}
      >
        <span className="icon" aria-hidden="true">
          <i className="fa-solid fa-gear"></i>
        </span>
        <span className="label">Setup</span>
      </button>
      <button
        className={`nav-item ${activeTab === 'rules' ? 'active' : ''}`}
        onClick={() => onTabChange('rules')}
      >
        <span className="icon" aria-hidden="true">
          <i className="fa-solid fa-arrow-down-1-9"></i>
        </span>
        <span className="label">Rules</span>
      </button>
    </aside>
  );
}

export default Sidebar;
