import {useEffect} from 'react';
import {TopBar} from './components/TopBar';
import {WorkflowSidebar} from './components/WorkflowSidebar';
import {hasSeenGuide, startGuide} from './guide';
import {StepLanguage} from './steps/StepLanguage';
import {StepRender} from './steps/StepRender';
import {StepReview} from './steps/StepReview';
import {StepSave} from './steps/StepSave';
import {StepStyle} from './steps/StepStyle';
import {StepTranscribe} from './steps/StepTranscribe';
import {StepUpload} from './steps/StepUpload';
import {useWorkflow} from './store';

export const App = () => {
  const state = useWorkflow();

  // First visit: walk the user through the workflow once.
  useEffect(() => {
    if (hasSeenGuide()) return;
    const timer = window.setTimeout(() => startGuide(), 900);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div className="app">
      <TopBar />
      <div className="layout">
        <WorkflowSidebar />
        <main className="main">
          {state.step === 'upload' && <StepUpload />}
          {state.step === 'language' && <StepLanguage />}
          {state.step === 'transcribe' && <StepTranscribe />}
          {state.step === 'review' && <StepReview />}
          {state.step === 'save' && <StepSave />}
          {state.step === 'style' && <StepStyle />}
          {state.step === 'render' && <StepRender />}
        </main>
      </div>
    </div>
  );
};
