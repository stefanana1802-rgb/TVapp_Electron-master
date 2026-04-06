import React, { useState, useEffect, useRef } from 'react';

const NEW_COLLEAGUES = [
  { name: 'Maria Popescu', role: 'Software Engineer', funFact: 'Loves hiking and board games' },
  { name: 'Andrei Ionescu', role: 'Product Designer', funFact: 'Former jazz pianist' },
  { name: 'Elena Vasilescu', role: 'QA Lead', funFact: 'Runs marathons' },
  { name: 'David Moldovan', role: 'DevOps Engineer', funFact: 'Collects vintage keyboards' },
  { name: 'Raluca Stan', role: 'Frontend Developer', funFact: 'Photography and coffee enthusiast' },
  { name: 'Bogdan Nistor', role: 'Data Analyst', funFact: 'Plays guitar in a band' }
];

const WORK_ANNIVERSARY_MESSAGES_DEFAULT = [
  'Thank you for your dedication. Here\'s to many more years!',
  'We appreciate everything you do. Congratulations!',
  'Proud to have you on the team. Well done!',
  'Thank you and keep up the great work!',
  'Your commitment inspires us all. Cheers!'
];

/** Build example work anniversaries: 4 with join date this month (various years), 1 with another month (filtered out). */
function getWorkAnniversaryExamples(refDate) {
  const currentYear = refDate.getFullYear();
  const currentMonth = refDate.getMonth() + 1; // 1-12
  const names = ['Laura Popa', 'George Mihai', 'Simona Marin', 'Radu Constantinescu', 'Diana Ionescu'];
  const examples = [
    { name: names[0], joinMonth: currentMonth, joinYear: currentYear - 5 },
    { name: names[1], joinMonth: currentMonth, joinYear: currentYear - 3 },
    { name: names[2], joinMonth: currentMonth, joinYear: currentYear - 7 },
    { name: names[3], joinMonth: currentMonth, joinYear: currentYear - 2 },
    { name: names[4], joinMonth: currentMonth === 12 ? 1 : currentMonth + 1, joinYear: currentYear - 4 }
  ];
  return examples;
}

const EMPLOYEE_OF_MONTH_APPRECIATION = [
  'Outstanding contribution this month. Thank you!',
  'Your hard work doesn\'t go unnoticed. Bravo!',
  'Team player and always goes the extra mile.',
  'A true role model. We appreciate you!',
  'Exceptional work. Congratulations!'
];

const EMPLOYEES_OF_MONTH = [
  { name: 'Stefan Preda', job: 'Backend Developer' },
  { name: 'Adina Georgescu', job: 'UX Researcher' },
  { name: 'Vlad Munteanu', job: 'Project Manager' }
];

const JOB_OPENINGS = [
  { title: 'Senior Frontend Developer', team: 'Product' },
  { title: 'Data Engineer', team: 'Analytics' },
  { title: 'Scrum Master', team: 'Engineering' }
];

const EVENTS = [
  { name: 'Team Building', when: 'Apr 12–13' },
  { name: 'Tech Talk: Security', when: 'Apr 15, 14:00' },
  { name: 'Team Lunch', when: 'Apr 18' },
  { name: 'Beer & Pizza Friday', when: 'Apr 19, 17:00' }
];

function AvatarPlaceholder({ name, className = 'w-12 h-12' }) {
  const initial = name.split(' ').map((n) => n[0]).join('').slice(0, 2);
  return (
    <div className={`${className} rounded-full bg-gray-300 flex items-center justify-center text-gray-600 font-semibold text-sm shrink-0`}>
      {initial}
    </div>
  );
}

function parseWorkStart(str) {
  if (!str || typeof str !== 'string') return null;
  const d = new Date(str.slice(0, 10));
  if (isNaN(d.getTime())) return null;
  return { joinMonth: d.getMonth() + 1, joinYear: d.getFullYear() };
}
function formatEventWhen(dateStr, timeStr) {
  if (!dateStr) return timeStr || '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return timeStr || '';
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()];
  const day = d.getDate();
  if (timeStr) return `${mon} ${day}, ${timeStr}`;
  return `${mon} ${day}`;
}

function InfoCarousel({ sections = {} }) {
  const ann = sections.anniversary || {};
  const cooldownSeconds = Math.max(5, Math.min(3600, Number(ann.cooldownSeconds) || 20));
  const COOLDOWN_MS = cooldownSeconds * 1000;
  const people = Array.isArray(ann.people) ? ann.people : [];
  const employeeOfMonthNames = Array.isArray(ann.employeeOfMonth)
    ? ann.employeeOfMonth.filter((n) => typeof n === 'string' && n.trim())
    : [];
  const jobOpenings = Array.isArray(ann.jobOpenings) ? ann.jobOpenings : [];
  const events = Array.isArray(ann.events) ? ann.events : [];

  const newColleaguesFromWorkspace = people.filter((p) => p.newColleague && (p.name || '').trim()).map((p) => ({ name: p.name.trim(), role: 'New colleague', funFact: '' }));
  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();
  const workAnniversariesFromWorkspace = people
    .filter((p) => (p.name || '').trim() && p.workStartDate)
    .map((p) => {
      const w = parseWorkStart(p.workStartDate);
      return w ? { name: p.name.trim(), joinMonth: w.joinMonth, joinYear: w.joinYear } : null;
    })
    .filter(Boolean)
    .filter((p) => p.joinMonth === currentMonth)
    .map((p) => ({ ...p, years: currentYear - p.joinYear }));
  const employeesOfMonthFromWorkspace = employeeOfMonthNames.map((name) => ({ name, job: '' }));
  const eventsFromWorkspace = events.filter((e) => (e.name || '').trim()).map((e) => ({ name: e.name.trim(), when: formatEventWhen(e.date, e.time) }));

  const NEW_COLLEAGUES_USE = newColleaguesFromWorkspace;
  const upcomingWorkAnniversaries = workAnniversariesFromWorkspace;
  const EMPLOYEES_OF_MONTH_USE = employeesOfMonthFromWorkspace;
  const JOB_OPENINGS_USE = jobOpenings;
  const EVENTS_USE = eventsFromWorkspace;

  const allCategories = [
    'new_colleagues',
    'work_anniversary',
    'employee_of_month',
    'job_openings',
    'events'
  ];
  const pageCountsByKey = [
    Math.ceil(NEW_COLLEAGUES_USE.length / 2),
    upcomingWorkAnniversaries.length === 0 ? 0 : Math.ceil(upcomingWorkAnniversaries.length / 2),
    EMPLOYEES_OF_MONTH_USE.length === 0 ? 0 : Math.ceil(EMPLOYEES_OF_MONTH_USE.length / 2),
    Math.ceil(JOB_OPENINGS_USE.length / 2),
    Math.ceil(EVENTS_USE.length / 2)
  ];
  const categoriesWithContent = allCategories.filter((_, i) => (pageCountsByKey[i] || 0) > 0);

  const [categoryIndex, setCategoryIndex] = useState(0);
  const [itemIndex, setItemIndex] = useState(0);
  const [cooldownStart, setCooldownStart] = useState(() => Date.now());
  const [elapsed, setElapsed] = useState(0);

  const stateRef = useRef({ categoryIndex: 0, itemIndex: 0 });
  const dataRef = useRef({ categoriesWithContent: [], pageCountsByKey: [] });
  stateRef.current = { categoryIndex, itemIndex };
  dataRef.current = { categoriesWithContent, pageCountsByKey };

  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now();
      const e = now - cooldownStart;
      setElapsed(e);
      if (e >= COOLDOWN_MS) {
        const { categoryIndex: cat, itemIndex: item } = stateRef.current;
        const { categoriesWithContent: list, pageCountsByKey: counts } = dataRef.current;
        if (list.length === 0) {
          setCooldownStart(now);
          setElapsed(0);
          return;
        }
        const key = list[cat];
        const keyIdx = allCategories.indexOf(key);
        const pages = (keyIdx >= 0 && counts[keyIdx] != null) ? counts[keyIdx] : 0;
        if (pages > 0 && item + 1 < pages) {
          setItemIndex(item + 1);
        } else {
          setCategoryIndex((i) => (i + 1) % list.length);
          setItemIndex(0);
        }
        setCooldownStart(now);
        setElapsed(0);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [cooldownStart, categoriesWithContent.length]);

  const safeCategoryIndex = categoriesWithContent.length > 0 ? Math.min(categoryIndex, categoriesWithContent.length - 1) : 0;
  const currentCategoryKey = categoriesWithContent[safeCategoryIndex] || null;

  useEffect(() => {
    if (categoriesWithContent.length > 0 && categoryIndex >= categoriesWithContent.length) {
      setCategoryIndex(0);
      setItemIndex(0);
    }
  }, [categoriesWithContent.length, categoryIndex]);

  const cooldownPercent = Math.max(0, Math.min(100, 100 - (elapsed / COOLDOWN_MS) * 100));
  const categoryLabelMap = {
    new_colleagues: 'New colleagues',
    work_anniversary: 'Work anniversary',
    employee_of_month: 'Employee of the month',
    job_openings: 'Job openings',
    events: 'Events'
  };
  const categoryLabel = currentCategoryKey ? categoryLabelMap[currentCategoryKey] : 'Info';

  const renderContent = () => {
    if (!currentCategoryKey) {
      return <p className="text-xs text-gray-500 py-2">No content in this section yet.</p>;
    }
    switch (currentCategoryKey) {
      case 'new_colleagues': {
        if (NEW_COLLEAGUES_USE.length === 0) return <p className="text-xs text-gray-500 py-2">No new colleagues.</p>;
        const take = 2;
        const start = (itemIndex * take) % Math.max(1, NEW_COLLEAGUES_USE.length);
        const items = NEW_COLLEAGUES_USE.length >= 2
          ? [NEW_COLLEAGUES_USE[start % NEW_COLLEAGUES_USE.length], NEW_COLLEAGUES_USE[(start + 1) % NEW_COLLEAGUES_USE.length]]
          : [NEW_COLLEAGUES_USE[0]];
        return (
          <div className="space-y-2 flex-1 flex flex-col justify-center min-h-0">
            {items.map((p) => (
              <div key={p.name} className="flex items-center gap-2 py-1.5 px-2 rounded-lg bg-gray-50 border border-gray-100 flex-1 min-h-0">
                <AvatarPlaceholder name={p.name} className="w-9 h-9 text-xs" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-gray-900">{p.name}</p>
                  <p className="text-xs text-accent font-medium mt-0.5">Good luck!</p>
                </div>
              </div>
            ))}
          </div>
        );
      }
      case 'work_anniversary': {
        if (upcomingWorkAnniversaries.length === 0) {
          return (
            <p className="text-xs text-gray-500 py-2">No work anniversaries this month.</p>
          );
        }
        const start = (itemIndex * 2) % upcomingWorkAnniversaries.length;
        const items = upcomingWorkAnniversaries.length >= 2
          ? [upcomingWorkAnniversaries[start], upcomingWorkAnniversaries[(start + 1) % upcomingWorkAnniversaries.length]]
          : [upcomingWorkAnniversaries[start]];
        return (
          <div className="space-y-2 flex-1 flex flex-col justify-center min-h-0">
            {items.map((person, i) => {
              const msgIdx = (categoryIndex + itemIndex + start + i) % WORK_ANNIVERSARY_MESSAGES_DEFAULT.length;
              const msg = WORK_ANNIVERSARY_MESSAGES_DEFAULT[msgIdx];
              return (
                <div key={person.name} className="flex items-center gap-2 py-1.5 px-2 rounded-lg bg-gray-50 border border-gray-100 flex-1 min-h-0">
                  <AvatarPlaceholder name={person.name} className="w-9 h-9 text-xs" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-gray-900">{person.name}</p>
                    <p className="text-xs text-gray-600">{person.years} years this month</p>
                    <p className="text-xs text-gray-700 mt-0.5">{msg}</p>
                  </div>
                </div>
              );
            })}
          </div>
        );
      }
      case 'employee_of_month': {
        if (EMPLOYEES_OF_MONTH_USE.length === 0) return <p className="text-xs text-gray-500 py-2">No employee of the month.</p>;
        const take = Math.min(2, EMPLOYEES_OF_MONTH_USE.length);
        const start = (itemIndex * take) % EMPLOYEES_OF_MONTH_USE.length;
        const items = take === 1 ? [EMPLOYEES_OF_MONTH_USE[0]] : [EMPLOYEES_OF_MONTH_USE[start], EMPLOYEES_OF_MONTH_USE[(start + 1) % EMPLOYEES_OF_MONTH_USE.length]];
        return (
          <div className="space-y-2 flex-1 flex flex-col justify-center min-h-0">
            {items.map((person, i) => {
              const msgIdx = (categoryIndex + itemIndex + start + i) % EMPLOYEE_OF_MONTH_APPRECIATION.length;
              const msg = EMPLOYEE_OF_MONTH_APPRECIATION[msgIdx];
              return (
                <div key={person.name} className="flex items-center gap-2 py-1.5 px-2 rounded-lg bg-amber-50 border border-amber-100 flex-1 min-h-0">
                  <AvatarPlaceholder name={person.name} className="w-9 h-9 text-xs" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-gray-900">{person.name}</p>
                    <p className="text-xs text-amber-800 mt-0.5">{msg}</p>
                  </div>
                </div>
              );
            })}
          </div>
        );
      }
      case 'job_openings': {
        if (JOB_OPENINGS_USE.length === 0) return <p className="text-xs text-gray-500 py-2">No job openings.</p>;
        const take = Math.min(2, JOB_OPENINGS_USE.length);
        const start = (itemIndex * take) % JOB_OPENINGS_USE.length;
        const items = take === 1 ? [JOB_OPENINGS_USE[0]] : [JOB_OPENINGS_USE[start], JOB_OPENINGS_USE[(start + 1) % JOB_OPENINGS_USE.length]];
        return (
          <div className="space-y-2 flex-1 flex flex-col justify-center min-h-0">
            {items.map((j) => (
              <div key={(j.title || '') + (j.team || '')} className="py-1.5 px-2 rounded-lg bg-gray-50 border border-gray-100 flex-1 min-h-0 flex flex-col justify-center">
                <p className="text-sm font-semibold text-gray-900">{j.title}</p>
                <p className="text-xs text-gray-600 mt-0.5">{j.team}</p>
              </div>
            ))}
          </div>
        );
      }
      case 'events': {
        if (EVENTS_USE.length === 0) return <p className="text-xs text-gray-500 py-2">No events.</p>;
        const take = Math.min(2, EVENTS_USE.length);
        const start = (itemIndex * take) % EVENTS_USE.length;
        const items = take === 1 ? [EVENTS_USE[0]] : [EVENTS_USE[start], EVENTS_USE[(start + 1) % EVENTS_USE.length]];
        return (
          <div className="space-y-2 flex-1 flex flex-col justify-center min-h-0">
            {items.map((e) => (
              <div key={e.name + (e.when || '')} className="py-1.5 px-2 rounded-lg bg-gray-50 border border-gray-100 flex-1 min-h-0 flex flex-col justify-center">
                <p className="text-sm font-semibold text-gray-900">{e.name}</p>
                <p className="text-xs text-gray-600 mt-0.5">{e.when}</p>
              </div>
            ))}
          </div>
        );
      }
      default:
        return null;
    }
  };

  return (
    <div className="w-full flex flex-col gap-1 min-h-0 overflow-hidden h-full">
      <div className="flex items-center justify-between gap-1 shrink-0 py-0.5">
        <span className="text-xs uppercase tracking-[0.1em] font-semibold text-gray-600 truncate">{categoryLabel}</span>
        <span className="text-[0.6rem] text-gray-400 tabular-nums">{Math.ceil((COOLDOWN_MS - elapsed) / 1000)}s</span>
      </div>
      <div className="h-1 w-full rounded-full bg-gray-200 overflow-hidden shrink-0">
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-1000 ease-linear"
          style={{ width: `${cooldownPercent}%` }}
        />
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto text-sm py-1" key={currentCategoryKey ?? 'none'}>
        {renderContent()}
      </div>
    </div>
  );
}

export default InfoCarousel;
