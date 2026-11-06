package calc.DTO;

import calc.entity.User;
import calc.entity.Sport;

import javax.persistence.*;
import java.util.ArrayList;

/**
 * Created by clementperez on 10/2/16.
 */
public class TournamentDTO {

    private Long tournamentId;
    private String name;
    private String displayName;
    private Boolean isOver;
    private SportDTO sport;
    private UserDTO owner;

    public TournamentDTO() {
        super();
    }

    public TournamentDTO(String name, SportDTO sport, UserDTO owner) {
        this.displayName = name;
        this.sport = sport;
        this.owner = owner;
    }

    public UserDTO getOwner() {
        return owner;
    }

    public void setOwner(UserDTO owner) {
        this.owner = owner;
    }

    public Long getTournamentId() {
        return tournamentId;
    }

    public void setTournamentId(Long tournamentId) {
        this.tournamentId = tournamentId;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public String getDisplayName() {
        return displayName;
    }

    public void setDisplayName(String displayName) {
        this.displayName = displayName;
    }

    public Boolean getIsOver() {
        return isOver;
    }

    public void setIsOver(Boolean isOver) {
        this.isOver = isOver;
    }

    public SportDTO getSport() {
        return sport;
    }

    public void setSport(SportDTO sport) {
        this.sport = sport;
    }
}
