import React, { useCallback, useRef, useState } from "react";
import { useAppDispatch } from "../hooks";
import { removeConversation } from "../store/conversation";
import { Conversation } from "../types";
import Icon from "./Icon";

interface Tab {
  name: string;
  href: string;
}

interface Props {
  tabs: Tab[];
  currentConversation: Conversation;
  navigate: (href: string) => void;
  conversationList: Conversation[];
  createNewConversation: () => void;
  className?: string;
}

const Tabs: React.FC<Props> = ({
  tabs,
  currentConversation,
  navigate,
  conversationList,
  createNewConversation,
  className,
}) => {
  const dispatch = useAppDispatch();
  const selectedTabRef = useRef<HTMLButtonElement>(null);
  const selectRef = useRef<HTMLButtonElement>(null);
  const parentRef = useRef<HTMLDivElement>(null);
  const [showOptions, setShowOptions] = useState(false);

  const handleToggleOptions = useCallback(() => {
    setShowOptions((prevShowOptions) => !prevShowOptions);

    // put focus inside the select option list
    requestAnimationFrame(() => {
      if (selectedTabRef.current) {
        selectedTabRef.current.focus();
      }
    });
  }, []);

  const handleSelectChange = useCallback(
    (selectedTab: Tab) => {
      if (selectedTab) {
        navigate(selectedTab.href);
        setShowOptions(false);
      }
    },
    [navigate]
  );

  const handleClose = useCallback(
    (e: React.MouseEvent | React.KeyboardEvent) => {
      e.stopPropagation();

      if (conversationList.length === 1) {
        createNewConversation();
      } else {
        navigate(
          `/chat/${encodeURI(
            conversationList[0].id === currentConversation.id
              ? conversationList[1].id
              : conversationList[0].id
          )}`
        );
      }

      dispatch(removeConversation(currentConversation.id));
    },
    [
      conversationList,
      currentConversation.id,
      createNewConversation,
      navigate,
      dispatch,
    ]
  );

  const selectedTabName = tabs.find(
    (tab) => currentConversation.title === tab.name
  )?.name;

  return (
    <div className={`relative ${className}`} ref={parentRef}>
      <button
        className="flex-grow w-full flex items-center px-2 py-1 border border-menu text-xs rounded-md cursor-pointer hover:bg-menu-selection focus:outline-none focus:ring-tab-active"
        onClick={handleToggleOptions}
        ref={selectRef}
      >
        <span className="pl-1 flex-grow user-select-none text-start">
          {selectedTabName}
        </span>
        <Icon icon="caret-down" className="w-6 h-6 p-1" />
        <span
          role="button"
          tabIndex={0}
          className="block p-1 hover:text-white focus:outline-none hover:bg-opacity-40 hover:bg-red-900 focus:bg-red-900 rounded-md"
          onClick={handleClose}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              handleClose(e);
            }
          }}
        >
          <Icon icon="close" className="w-4 h-4" />
        </span>
      </button>
      {showOptions && (
        <div
          className="absolute z-10 w-full bg-menu shadow-lg border border-menu max-h-60 overflow-auto top-[1.9rem] left-0 rounded-b-md"
          role="menu"
        >
          {tabs.map((tab, index) => (
            <button
              key={index}
              role="menuitem"
              aria-selected={currentConversation.title === tab.name}
              onClick={() => handleSelectChange(tab)}
              ref={selectedTabRef}
              className={`w-full text-start py-2 px-2 text-xs bg-menu hover:bg-menu-selection focus:bg-menu-selection focus:underline cursor-pointer appearance-none ${
                currentConversation.title === tab.name
                  ? "bg-menu-selection font-semibold"
                  : ""
              }`}
            >
              {tab.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default Tabs;
