import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";

const PAGE_SIZE_OPTIONS = [10, 25, 50];

const valueFor = (getter, row) => {
  const value = getter?.(row);
  return value == null ? "" : String(value).trim();
};

const displayFilterValue = (value) =>
  value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

export default function DataTableTools({
  rows = [],
  getSearchText,
  filters = [],
  loading = false,
  searchLabel = "records",
  emptyText = "No records are available.",
  children
}) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE_OPTIONS[0]);
  const [filterValues, setFilterValues] = useState({});

  const filterOptions = useMemo(
    () =>
      filters.map((filter) => ({
        ...filter,
        options: [...new Set(rows.map((row) => valueFor(filter.getValue, row)).filter(Boolean))]
          .sort((left, right) => left.localeCompare(right))
      })),
    [filters, rows]
  );

  const filteredRows = useMemo(() => {
    const searchTerm = query.trim().toLocaleLowerCase();
    return rows.filter((row) => {
      const matchesSearch =
        !searchTerm ||
        valueFor(getSearchText, row).toLocaleLowerCase().includes(searchTerm);
      const matchesFilters = filterOptions.every((filter) => {
        const selected = filterValues[filter.key];
        return !selected || valueFor(filter.getValue, row) === selected;
      });
      return matchesSearch && matchesFilters;
    });
  }, [filterOptions, filterValues, getSearchText, query, rows]);

  const pageCount = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const startIndex = (currentPage - 1) * pageSize;
  const pageRows = filteredRows.slice(startIndex, startIndex + pageSize);
  const firstRecord = filteredRows.length ? startIndex + 1 : 0;
  const lastRecord = Math.min(startIndex + pageSize, filteredRows.length);

  const updateQuery = (value) => {
    setQuery(value);
    setPage(1);
  };

  const updateFilter = (key, value) => {
    setFilterValues((previous) => ({ ...previous, [key]: value }));
    setPage(1);
  };

  return (
    <div className="app-table-container min-w-0 max-w-full overflow-x-auto">
      <div className="app-table-tools">
        <label className="app-table-search">
          <Search aria-hidden="true" />
          <span className="sr-only">Search {searchLabel}</span>
          <input
            type="search"
            value={query}
            onChange={(event) => updateQuery(event.target.value)}
            placeholder={`Search ${searchLabel.toLowerCase()}…`}
          />
        </label>
        {filterOptions.map((filter) => (
          <label className="app-table-filter" key={filter.key}>
            <span className="sr-only">Filter by {filter.label}</span>
            <select
              aria-label={`Filter by ${filter.label}`}
              value={filterValues[filter.key] || ""}
              onChange={(event) => updateFilter(filter.key, event.target.value)}
            >
              <option value="">All {filter.label.toLowerCase()}</option>
              {filter.options.map((option) => (
                <option key={option} value={option}>
                  {displayFilterValue(option)}
                </option>
              ))}
            </select>
          </label>
        ))}
        <span className="app-table-count" aria-live="polite">
          {filteredRows.length} {filteredRows.length === 1 ? "record" : "records"}
        </span>
      </div>

      {loading ? (
        <div className="app-table-skeleton" role="status" aria-label="Loading records">
          <span />
          <span />
          <span />
          <span />
        </div>
      ) : (
        children({
          rows: pageRows,
          startIndex,
          totalRows: rows.length,
          filteredCount: filteredRows.length,
          emptyMessage: rows.length ? "No records match the current search or filters." : emptyText
        })
      )}

      {!loading && (
        <div className="app-table-pagination">
          <div className="flex flex-wrap items-center gap-2">
            <span>
              Showing {firstRecord}–{lastRecord} of {filteredRows.length}
            </span>
            <label className="flex items-center gap-2">
              <span>Rows</span>
              <select
                aria-label="Rows per page"
                value={pageSize}
                onChange={(event) => {
                  setPageSize(Number(event.target.value));
                  setPage(1);
                }}
              >
                {PAGE_SIZE_OPTIONS.map((size) => (
                  <option key={size} value={size}>{size}</option>
                ))}
              </select>
              <span>per page</span>
            </label>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label="Previous page"
              disabled={currentPage <= 1}
              onClick={() => setPage(Math.max(1, currentPage - 1))}
            >
              <ChevronLeft aria-hidden="true" className="h-4 w-4" />
            </button>
            <span aria-live="polite">Page {currentPage} of {pageCount}</span>
            <button
              type="button"
              aria-label="Next page"
              disabled={currentPage >= pageCount}
              onClick={() => setPage(Math.min(pageCount, currentPage + 1))}
            >
              <ChevronRight aria-hidden="true" className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
