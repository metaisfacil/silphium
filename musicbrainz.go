package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"
	"time"
)

type MusicBrainzArtistInfo struct {
	Found          bool             `json:"found"`
	MBID           string           `json:"mbid"`
	Name           string           `json:"name"`
	Type           string           `json:"type"`
	Country        string           `json:"country"`
	Disambiguation string           `json:"disambiguation"`
	LifeSpan       string           `json:"lifeSpan"`
	Genres         []string         `json:"genres"`
	URLs           []MusicBrainzURL `json:"urls"`
}

type MusicBrainzURL struct {
	Type     string `json:"type"`
	Resource string `json:"resource"`
}

func (a *App) LookupArtistByMBID(mbid string) MusicBrainzArtistInfo {
	cleanMBID := strings.ToLower(strings.TrimSpace(mbid))
	if !mbidPattern.MatchString(cleanMBID) {
		return MusicBrainzArtistInfo{Found: false}
	}

	requestURL := fmt.Sprintf("https://musicbrainz.org/ws/2/artist/%s?fmt=json&inc=genres+tags+url-rels", cleanMBID)
	request, err := http.NewRequest(http.MethodGet, requestURL, nil)
	if err != nil {
		return MusicBrainzArtistInfo{Found: false}
	}

	request.Header.Set("Accept", "application/json")
	request.Header.Set("User-Agent", "Silphium/1.0 (metaisfacil@users.noreply.github.com)")

	client := &http.Client{Timeout: 10 * time.Second}
	response, err := client.Do(request)
	if err != nil {
		return MusicBrainzArtistInfo{Found: false}
	}
	defer response.Body.Close()

	if response.StatusCode != http.StatusOK {
		return MusicBrainzArtistInfo{Found: false}
	}

	responseBody, err := io.ReadAll(response.Body)
	if err != nil {
		return MusicBrainzArtistInfo{Found: false}
	}

	type mbGenre struct {
		Name  string `json:"name"`
		Count int    `json:"count"`
	}

	type mbLifeSpan struct {
		Begin string `json:"begin"`
		End   string `json:"end"`
		Ended bool   `json:"ended"`
	}

	type mbArtistResponse struct {
		ID             string     `json:"id"`
		Name           string     `json:"name"`
		Type           string     `json:"type"`
		Country        string     `json:"country"`
		Disambiguation string     `json:"disambiguation"`
		LifeSpan       mbLifeSpan `json:"life-span"`
		Genres         []mbGenre  `json:"genres"`
		Tags           []mbGenre  `json:"tags"`
		Relations      []struct {
			Type       string `json:"type"`
			TargetType string `json:"target-type"`
			URL        struct {
				Resource string `json:"resource"`
			} `json:"url"`
		} `json:"relations"`
	}

	var payload mbArtistResponse
	if err := json.Unmarshal(responseBody, &payload); err != nil {
		return MusicBrainzArtistInfo{Found: false}
	}

	lifeSpan := strings.TrimSpace(payload.LifeSpan.Begin)
	if payload.LifeSpan.End != "" {
		if lifeSpan == "" {
			lifeSpan = "?"
		}
		lifeSpan = fmt.Sprintf("%s – %s", lifeSpan, payload.LifeSpan.End)
	} else if payload.LifeSpan.Ended {
		if lifeSpan == "" {
			lifeSpan = "?"
		}
		lifeSpan = fmt.Sprintf("%s –", lifeSpan)
	}

	genres := payload.Genres
	if len(genres) == 0 {
		genres = payload.Tags
	}

	sort.SliceStable(genres, func(i, j int) bool {
		return genres[i].Count > genres[j].Count
	})

	genreNames := make([]string, 0, 6)
	seenGenres := make(map[string]struct{})
	for _, genre := range genres {
		name := strings.TrimSpace(genre.Name)
		if name == "" {
			continue
		}

		key := strings.ToLower(name)
		if _, exists := seenGenres[key]; exists {
			continue
		}

		seenGenres[key] = struct{}{}
		genreNames = append(genreNames, name)
		if len(genreNames) >= 6 {
			break
		}
	}

	if payload.Name == "" {
		return MusicBrainzArtistInfo{Found: false}
	}

	urls := make([]MusicBrainzURL, 0)
	seenURL := make(map[string]struct{})
	for _, relation := range payload.Relations {
		if !strings.EqualFold(relation.TargetType, "url") {
			continue
		}

		resource := strings.TrimSpace(relation.URL.Resource)
		if resource == "" {
			continue
		}

		if _, exists := seenURL[resource]; exists {
			continue
		}

		seenURL[resource] = struct{}{}
		urls = append(urls, MusicBrainzURL{
			Type:     strings.TrimSpace(relation.Type),
			Resource: resource,
		})
	}

	sort.SliceStable(urls, func(i, j int) bool {
		if urls[i].Type == urls[j].Type {
			return urls[i].Resource < urls[j].Resource
		}
		return urls[i].Type < urls[j].Type
	})

	return MusicBrainzArtistInfo{
		Found:          true,
		MBID:           payload.ID,
		Name:           payload.Name,
		Type:           payload.Type,
		Country:        payload.Country,
		Disambiguation: payload.Disambiguation,
		LifeSpan:       lifeSpan,
		Genres:         genreNames,
		URLs:           urls,
	}
}
