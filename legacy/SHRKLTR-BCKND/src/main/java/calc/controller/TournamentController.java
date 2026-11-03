package calc.controller;

import calc.DTO.*;
import calc.entity.Tournament;
import calc.entity.User;
import calc.exception.APIException;
import calc.security.Secured;
import calc.service.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Description;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

import java.util.*;
import java.util.stream.Collectors;


/**
 * Created by clementperez on 9/22/16.
 */

@RestController
@Secured
public class TournamentController {

    @Autowired
    private TournamentService tournamentService;
    @Autowired
    private StatsService statsService;
    @Autowired
    private RivalryStatsService rivalryStatsService;
    @Autowired
    private GameService gameService;
    @Autowired
    private SportService sportService;
    @Autowired
    private UserService userService;

    @RequestMapping(value = "/tournaments/all", method = RequestMethod.GET)
    public List<TournamentDTO> tournaments() {

        return tournamentService.findAll();
    }

    @RequestMapping(value = "/tournaments", method = RequestMethod.GET)
    public List<TournamentDTO> tournamentsForSport(@RequestParam(value="sport") String name) {

        List<TournamentDTO> tournamentSet;
        if(name != null && !name.equalsIgnoreCase("")){
            SportDTO sport = sportService.findByName(name);
            tournamentSet = tournamentService.findBySport(sport);
        }else{
            tournamentSet = tournamentService.findAll();
        }

        return tournamentSet;
    }

    /**
     * Let the owner of a Tournament to delete it.
     * @param name 
     */
    @RequestMapping(value = "/tournament/{tournamentName}", method = RequestMethod.DELETE)
    @Description("Let the owner of a Tournament to delete it.")
    public void deleteTournament(@PathVariable(value="tournamentName") String name) {
        TournamentDTO t = tournamentService.findByName(name);
        tournamentService.delete(t);
    }

    /**
     * Create a Tournament
     *
     * @param tournament
     */
    @RequestMapping(value = "/tournament", method = RequestMethod.POST)
    public TournamentDTO createTournament(@RequestBody TournamentDTO tournament) {

        return tournamentService.createTournament(tournament);
    }

    @RequestMapping(value = "/tournament/{tournamentName}", method = RequestMethod.PUT)
    public TournamentDTO updateTournament(@PathVariable(value="tournamentName") String name, TournamentDTO tournament) {

        TournamentDTO t = tournamentService.findByName(tournament.getName());
        if(t == null){
            throw new APIException(Tournament.class,name, HttpStatus.NOT_FOUND);
        }
        return tournamentService.update(tournament);
    }

    @RequestMapping(value = "/tournament/{tournamentName}", method = RequestMethod.GET)
    public Map tournamentNamed(@PathVariable(value="tournamentName") String name) {

        TournamentDTO t = tournamentService.findByName(name);
        if(t == null){
            throw new APIException(Tournament.class,name,HttpStatus.NOT_FOUND);
        }

//        List<StatsDTO> stats = statsService.findByTournament(tournament);

        HashMap map = new HashMap<>();
        map.put("tournament",t);
 //       map.put("stats",stats);
        return map;
    }

    @RequestMapping(value = "/tournament/{tournamentName}/games", method = RequestMethod.GET)
    public List<GameDTO> gamesForTournament(@PathVariable(value="tournamentName") String name,
                                            @RequestParam("page") Optional<Integer> page,
                                            @RequestParam("page_size") Optional<Integer> pageSize) {

        TournamentDTO t = tournamentService.findByName(name);
        if(t == null){
            throw new APIException(Tournament.class,name,HttpStatus.NOT_FOUND);
        }

        Pageable pageable = null;
        if(page.isPresent() && pageSize.isPresent()){
            pageable = new PageRequest(page.get(),pageSize.get());
        }

        List<GameDTO> games = gameService.findByTournamentName(name,pageable);
        return games;
    }

    @RequestMapping(value = "/tournament/{tournamentName}/games", method = RequestMethod.POST)
    public GameDTO addGameForTournament(@PathVariable(value="tournamentName") String name, @RequestBody GameDTO game){

        TournamentDTO t = tournamentService.findByName(name);
        if(t == null){
            throw new APIException(Tournament.class,name,HttpStatus.NOT_FOUND);
        }

        return tournamentService.addGameForTournament(name,game);
    }

    @RequestMapping(value = "/tournament/{tournamentName}/stats", method = RequestMethod.GET)
    public List<StatsDTO> statsForTournament(@PathVariable(value="tournamentName") String name) {

        TournamentDTO t = tournamentService.findByName(name);
        if(t == null){
            throw new APIException(Tournament.class,name,HttpStatus.NOT_FOUND);
        }
        return statsService.findByTournament(t);
    }

    @RequestMapping(value = "/tournament/{tournamentName}/rivalry", method = RequestMethod.GET)
    public RivalryStatsDTO statsForTournamentBetweenUsers(@PathVariable(value="tournamentName") String name,@RequestParam(value="userName") String userName,@RequestParam(value="rivalName") String rivalName) {

        TournamentDTO t = tournamentService.findByName(name);
        if(t == null){
            throw new APIException(Tournament.class,name,HttpStatus.NOT_FOUND);
        }

        UserDTO u = userService.findByUserName(userName);
        UserDTO r = userService.findByUserName(rivalName);

        if(u == null || r == null){
            throw new APIException(User.class,userName + " or " + rivalName,HttpStatus.NOT_FOUND);
        }

        return rivalryStatsService.findByUserAndRivalAndTournament(u.getUserId(),r.getUserId(),t.getTournamentId());
    }

    @RequestMapping(value = "/tournament/{tournamentName}/users", method = RequestMethod.GET)
    public List<UserDTO> usersForTournament(@PathVariable(value="tournamentName") String name) {

        TournamentDTO t = tournamentService.findByName(name);
        if(t == null){
            throw new APIException(Tournament.class,name,HttpStatus.NOT_FOUND);
        }
        return userService.findUsersInTournamentNamed(name);
    }
}
