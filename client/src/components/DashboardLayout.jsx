import React, { useState } from 'react';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import NewProjectModal from './NewProjectModal';
import { GlossaryProvider } from '../context/GlossaryContext';
import GlossaryTooltipScanner from './GlossaryTooltipScanner';

const DashboardLayout = ({ children, title, subtitle }) => {
  const [showProjectModal, setShowProjectModal] = useState(false);

  return (
    <GlossaryProvider>
      <div className="page-layout">
        <Sidebar onNewProject={() => setShowProjectModal(true)} />
        <div className="main-content">
          <Topbar title={title} subtitle={subtitle} />
          <div className="page-body">{children}</div>
        </div>
        {showProjectModal && (
          <NewProjectModal onClose={() => setShowProjectModal(false)} />
        )}
      </div>
      <GlossaryTooltipScanner />
    </GlossaryProvider>
  );
};

export default DashboardLayout;
